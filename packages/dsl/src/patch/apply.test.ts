import { createCoreRegistries, createStore, type ShapeDef, type Store } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { applyPatchCommand } from './apply.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

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
const command = applyPatchCommand(registries);
const fresh = (): Store => createStore(compile(SOURCE, { registries }).doc as never);
const apply = (store: Store, patch: unknown) => command.run({ store }, { patch });

type Case = { readonly patch: unknown };
const valid = Object.entries(import.meta.glob('./__fixtures__/patch/valid-*.json', { query: '?raw', import: 'default', eager: true })).map(
  ([file, text]) => [file.replace(/^.*\/(.*)\.json$/, '$1'), (JSON.parse(text) as Case).patch] as const,
);

describe('ai.applyPatch (FR-AI-003)', () => {
  for (const [name, patch] of valid) {
    it(`FR-AI-003: ${name} applies as one undo entry, and undo restores the document`, () => {
      const store = fresh();
      const before = JSON.stringify(store.toDocument());
      const entries = store.history.undoDepth;
      const r = apply(store, patch);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(JSON.stringify(store.toDocument())).not.toBe(before);
      expect(store.history.undoDepth).toBe(entries + 1);
      expect(store.history.undo().ok).toBe(true);
      const after = store.toDocument();
      expect(Object.keys(after.records).sort()).toEqual(Object.keys(JSON.parse(before).records).sort());
      for (const [id, record] of Object.entries(JSON.parse(before).records)) expect(after.records[id as never], id).toEqual(record);
    });
  }

  it('FR-AI-003: an invalid patch changes nothing and says why', () => {
    const store = fresh();
    const before = JSON.stringify(store.toDocument());
    const r = apply(store, {
      flux: 1,
      ops: [
        { op: 'add', screen: 'arch', slug: 'cache', node: { shape: 'rect' } },
        { op: 'remove', target: 'nope' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.diagnostics.map((d) => d.code)).toEqual(['FLX_PATCH_REF_UNKNOWN']);
    expect(JSON.stringify(store.toDocument())).toBe(before);
    expect(store.revision).toBe(0);
  });

  it('FR-AI-003: a patch for an older revision is stale, and the current one applies', () => {
    const store = fresh();
    const add = (slug: string, base: string) =>
      apply(store, { flux: 1, baseRevision: base, ops: [{ op: 'add', screen: 'arch', slug, node: { shape: 'rect' } }] });
    expect(add('one', 'r0').ok).toBe(true);
    const stale = add('two', 'r0');
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.diagnostics[0]?.code).toBe('FLX_PATCH_STALE');
    expect(add('two', `r${store.revision}`).ok).toBe(true);
  });

  it('FR-AI-003: new elements are laid out inside the screen, not on top of each other', () => {
    const store = fresh();
    apply(store, {
      flux: 1,
      ops: [
        { op: 'add', screen: 'arch', slug: 'cache', node: { shape: 'rect' } },
        { op: 'connect', edge: 'api -> cache' },
      ],
    });
    const boxes = store
      .members('byScreen', [...store.members('byType', 'screen')][0] as string)
      .map((id) => store.get(id) as unknown as { kind: string; transform?: { x: number; y: number } })
      .filter((r) => r.kind === 'shape')
      .map((r) => `${r.transform?.x},${r.transform?.y}`);
    expect(new Set(boxes).size).toBe(boxes.length);
  });

  it('FR-AI-003: an edge added by the patch can be removed by it, and removing a group takes its members and their edges', () => {
    const grouped = `${SOURCE}`.replace(
      'edges:',
      'groups:\n      tier: { label: Tier, contains: [api, db], layout: { type: stack, direction: down, gap: 24 } }\n    edges:',
    );
    const store = createStore(compile(grouped, { registries }).doc as never);
    const kinds = () => store.members('byType', 'element').map((id) => (store.get(id) as unknown as { kind: string }).kind);
    const r = apply(store, {
      flux: 1,
      ops: [
        { op: 'add', screen: 'arch', slug: 'cache', node: { shape: 'rect' } },
        { op: 'connect', edge: 'web -> cache' },
        { op: 'disconnect', target: 'web->cache' },
        { op: 'remove', target: 'tier', cascade: true },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // web and cache are left, and no edge: every edge of the base ended in the group
    expect(kinds().sort()).toEqual(['shape', 'shape']);
    expect(store.members('byType', 'binding')).toHaveLength(0);
    expect(store.history.undoDepth).toBe(1);
  });

  it('FR-AI-003: any run of valid patches, then full undo, restores the document', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: valid.length - 1 }), { minLength: 1, maxLength: 5 }), (picks) => {
        const store = fresh();
        const before = store.toDocument();
        // a patch that changes nothing (the same restyle twice) makes no entry
        for (const i of picks) apply(store, valid[i]?.[1]);
        const applied = store.history.undoDepth;
        for (let k = 0; k < applied; k += 1) expect(store.history.undo().ok).toBe(true);
        const after = store.toDocument();
        expect(Object.keys(after.records).sort()).toEqual(Object.keys(before.records).sort());
        for (const [id, record] of Object.entries(before.records)) expect(after.records[id as never]).toEqual(record);
      }),
    );
  });
});
