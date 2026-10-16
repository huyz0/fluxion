import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { layoutDocument } from './layout-document.js';

const registries = (() => {
  const r = createCoreRegistries();
  r.shapeDefs.register('basic:rect', { id: 'basic:rect' } as unknown as ShapeDef, 'basic');
  registerBuiltInLayouts(r.layouts);
  return r;
})();

const SOURCE = `flux: 1
title: Layout
uses: [basic]
screens:
  - id: flow
    nodes:
      a: { shape: rect }
      b: { shape: rect }
    edges:
      - a -> b
  - id: empty
`;

describe('layoutDocument (FR-LAY-001, FR-CLI-002)', () => {
  const doc = compile(SOURCE, { registries }).doc;

  it('FR-LAY-001: arranges every screen that has elements and leaves an empty one alone', () => {
    const r = layoutDocument(doc as NonNullable<typeof doc>, registries);
    expect(r).toMatchObject({ ok: true, screens: 1 });
  });

  it('FR-LAY-001: the same document and algorithm give the same document', () => {
    const d = doc as NonNullable<typeof doc>;
    expect(layoutDocument(d, registries, 'grid')).toEqual(layoutDocument(d, registries, 'grid'));
  });

  it('FR-LAY-001: an unknown algorithm fails with diagnostics instead of changing the document', () => {
    const r = layoutDocument(doc as NonNullable<typeof doc>, registries, 'nope');
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.diagnostics.length).toBeGreaterThan(0);
  });
});
