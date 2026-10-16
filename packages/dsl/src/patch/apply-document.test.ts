import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { patchDocument } from './apply-document.js';

const registries = (() => {
  const r = createCoreRegistries();
  r.shapeDefs.register('basic:rect', { id: 'basic:rect' } as unknown as ShapeDef, 'basic');
  registerBuiltInLayouts(r.layouts);
  return r;
})();

const doc = compile('flux: 1\ntitle: Patch\nuses: [basic]\nscreens:\n  - id: main\n    nodes:\n      a: { shape: rect }\n', { registries }).doc;

describe('patchDocument (FR-AI-003, ADR-0035)', () => {
  it('FR-AI-003: a valid patch adds the node and reports what it did', () => {
    const d = doc as NonNullable<typeof doc>;
    const r = patchDocument(d, { flux: 1, ops: [{ op: 'add', screen: 'main', slug: 'b', node: { shape: 'rect' } }] }, registries);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.applied.ops).toBe(1);
      expect(Object.keys(r.document.records).length).toBeGreaterThan(Object.keys(d.records).length);
    }
  });

  it('FR-AI-003: a patch that does not apply is rejected whole with FLX_PATCH diagnostics', () => {
    const r = patchDocument(doc as NonNullable<typeof doc>, { ops: [{ op: 'remove', target: 'nothing-here' }] }, registries);
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining([expect.stringMatching(/^FLX_PATCH_/)]));
  });

  it('FR-AI-003: a patch that is not an object of ops is rejected', () => {
    expect(patchDocument(doc as NonNullable<typeof doc>, 'nope', registries).ok).toBe(false);
  });
});
