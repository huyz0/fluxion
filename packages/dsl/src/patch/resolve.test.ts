import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { resolvePatch } from './resolve.js';
import { normalizeStrictPatch } from './working-index.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

type Case = { readonly patch: unknown; readonly ops?: readonly string[]; readonly errors?: readonly (readonly [string, string])[]; readonly revision?: string };
const cases = Object.entries(import.meta.glob('./__fixtures__/patch/*.json', { query: '?raw', import: 'default', eager: true })).map(
  ([file, text]) => [file.replace(/^.*\/(.*)\.json$/, '$1'), JSON.parse(text) as Case] as const,
);

const registries = (() => {
  const r = createCoreRegistries();
  for (const id of ['basic:rect', 'basic:rounded-rect']) r.shapeDefs.register(id, { id } as unknown as ShapeDef, 'basic');
  registerBuiltInLayouts(r.layouts);
  return r;
})();

const SOURCE = `flux: 1
title: Patch base
uses: [basic]
screens:
  - id: arch
    nodes:
      web: { shape: rect }
      api: { shape: rect }
      db: { shape: rect }
    edges:
      - web -> api
      - api -> db
      - api -> db
`;
const compiled = compile(SOURCE, { registries });
const records = compiled.doc?.records ?? {};

describe('the patch resolver and validator (FR-AI-003)', () => {
  it('FR-AI-003: the base document compiles with no error', () => {
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(Object.keys(records).length).toBeGreaterThan(8);
  });

  it('FR-AI-003: there is a fixture per op and per code', () => {
    const names = cases.map(([n]) => n);
    for (const kind of ['add', 'update', 'remove', 'connect', 'disconnect', 'setlayout', 'restyle'])
      expect(names.some((n) => n.startsWith('valid-') && n.includes(kind))).toBe(true);
    for (const code of ['stale', 'ref-unknown', 'ref-ambiguous', 'op-invalid', 'conflict', 'too-large'])
      expect(names.some((n) => n.startsWith(code))).toBe(true);
  });

  const run = (c: Case) => resolvePatch(c.patch, { records, registries, ...(c.revision ? { revision: c.revision } : {}) });
  for (const [name, c] of cases.filter(([, x]) => x.errors)) {
    it(`FR-AI-003: fixture ${name} is rejected whole with its pointer diagnostics`, () => {
      const result = run(c);
      const found = result.ok ? [] : result.diagnostics;
      expect(result.ok).toBe(false);
      expect(found.map((d) => [d.code, d.path])).toEqual(c.errors);
      expect(found.every((d) => (d.hint ?? d.message) !== '')).toBe(true);
    });
  }
  for (const [name, c] of cases.filter(([, x]) => !x.errors)) {
    it(`FR-AI-003: fixture ${name} resolves every op`, () => {
      const result = run(c);
      expect(result.ok ? result.value.ops.map((o) => o.op) : result).toEqual(c.ops);
    });
  }

  it('FR-AI-003: resolving writes nothing (the records are unchanged)', () => {
    const before = JSON.stringify(records);
    resolvePatch({ flux: 1, ops: [{ op: 'remove', target: 'db', cascade: true }] }, { records, registries });
    expect(JSON.stringify(records)).toBe(before);
  });

  it('FR-AI-003: slugs resolve to record ids, and an id written #<RecordId> resolves too', () => {
    const api = Object.values(records).find((r) => (r as { semantic?: { slug?: string } }).semantic?.slug === 'api');
    const byId = resolvePatch({ flux: 1, ops: [{ op: 'update', target: `#${api?.id}`, set: { label: 'x' } }] }, { records, registries });
    const bySlug = resolvePatch({ flux: 1, ops: [{ op: 'update', target: 'api', set: { label: 'x' } }] }, { records, registries });
    expect(byId.ok && bySlug.ok && byId.value.ops[0]).toEqual(bySlug.ok && bySlug.value.ops[0]);
    expect(bySlug.ok && bySlug.value.ops[0]).toMatchObject({ target: { id: api?.id, kind: 'element' } });
  });

  it('FR-AI-003: the strict form reads back as the plain one', () => {
    expect(normalizeStrictPatch({ a: null, b: { style: [{ key: 'fill', value: 'surface' }], c: null } })).toEqual({ b: { style: { fill: 'surface' } } });
  });

  it('FR-AI-003: a connect carries the label of the shorthand and the anchors of its ends', () => {
    const r = resolvePatch({ flux: 1, ops: [{ op: 'connect', edge: 'web.e -> db.w: reads' }] }, { records, registries });
    expect(r.ok && r.value.ops[0]).toMatchObject({ op: 'connect', anchors: { from: 'e', to: 'w' }, spec: { label: 'reads' } });
  });
});
