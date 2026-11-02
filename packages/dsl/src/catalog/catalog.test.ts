import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from './catalog.js';

const star = {
  id: 'basic:star',
  describe: 'A star with a chosen number of points.',
  params: { points: { type: 'int', min: 3, max: 64, default: 5 } },
} as unknown as ShapeDef;

function loaded(requireDescribe = false) {
  const r = createCoreRegistries({ requireDescribe });
  registerBuiltInLayouts(r.layouts);
  r.shapeDefs.register('basic:star', star, 'basic');
  return r;
}

describe('the AI catalog (FR-AI-002)', () => {
  it('FR-AI-002: lists shapes and layouts with their lines, sorted by id, and the plugin that registered each', () => {
    const { catalog, diagnostics } = buildCatalog(loaded());
    expect(diagnostics).toEqual([]);
    expect(catalog.shapes).toEqual([{ id: 'basic:star', describe: 'A star with a chosen number of points.', source: 'basic' }]);
    expect(catalog.layouts.map((l) => [l.id, l.source])).toEqual([
      ['circular', 'core'],
      ['fit', 'core'],
      ['force', 'core'],
      ['grid', 'core'],
      ['layered', 'core'],
      ['mindmap', 'core'],
      ['orgchart', 'core'],
      ['packing', 'core'],
      ['radial', 'core'],
      ['stack', 'core'],
      ['swimlane', 'core'],
      ['tidy', 'core'],
      ['timeline', 'core'],
      ['tree', 'core'],
    ]);
    expect(catalog.layouts.every((l) => l.describe.length > 0)).toBe(true);
  });

  it('FR-AI-002: lists what a plugin registers beside the built-ins', () => {
    const r = loaded();
    const mind = {
      id: 'mind',
      describe: 'Radial mind-map layout.',
      version: '1',
      schema: undefined,
      capabilities: {},
      parseOptions: () => ({ ok: true }),
      run: () => ({}),
    };
    r.layouts.register('mind', mind, 'mindmaps');
    r.shapeDefs.register('mindmaps:bubble', { id: 'mindmaps:bubble', describe: 'A rounded topic bubble.' } as unknown as ShapeDef, 'mindmaps');
    const { catalog } = buildCatalog(r);
    expect(catalog.layouts.find((l) => l.id === 'mind')).toMatchObject({ source: 'mindmaps', describe: 'Radial mind-map layout.' });
    expect(catalog.shapes.map((s) => s.id)).toEqual(['basic:star', 'mindmaps:bubble']);
  });

  it("FR-AI-002: a pack filter keeps only that pack, and full detail adds a shape's parameters and a layout's options schema", () => {
    const { catalog } = buildCatalog(loaded(), { pack: 'basic', detail: 'full' });
    expect(catalog.layouts).toEqual([]);
    expect(catalog.shapes[0]?.detail).toEqual({ params: { points: { type: 'int', min: 3, max: 64, default: 5 } } });
    const layouts = buildCatalog(loaded(), { pack: 'core', detail: 'full' }).catalog.layouts;
    expect(layouts.find((l) => l.id === 'layered')?.detail).toMatchObject({ options: { type: 'object' } });
    expect(buildCatalog(loaded()).catalog.layouts.every((l) => l.detail === undefined)).toBe(true);
  });

  it('NFR-AI-002: with core, another registrant is one summary line (named by the host, counted by kind) and its entries are read with its pack', () => {
    const r = loaded();
    r.shapeDefs.register('cloud:database', { id: 'cloud:database', describe: 'A managed database.' } as unknown as ShapeDef, 'cloud');
    r.shapeDefs.register('lucide:x', { id: 'lucide:x' } as unknown as ShapeDef, 'lucide');
    r.markers.register('cloud:flow', { id: 'cloud:flow', path: 'M0 0', inset: 0, filled: true, describe: 'A data-flow end.' }, 'cloud');
    const { catalog, diagnostics } = buildCatalog(r, { core: ['core', 'basic'], names: new Map([['cloud', 'Cloud architecture']]) });
    // a summarized pack's entries are not listed, so its missing describe lines are not reported here
    expect(diagnostics).toEqual([]);
    expect(catalog.shapes.map((s) => s.id)).toEqual(['basic:star']);
    expect(catalog.markers).toEqual([]);
    expect(catalog.layouts.length).toBeGreaterThan(0);
    expect(catalog.packs).toEqual([
      { id: 'cloud', name: 'Cloud architecture', count: 2, kinds: ['shapes', 'markers'] },
      { id: 'lucide', name: 'lucide', count: 1, kinds: ['shapes'] },
    ]);
    const cloud = buildCatalog(r, { core: ['core', 'basic'], pack: 'cloud' });
    expect([cloud.catalog.shapes.map((s) => s.id), cloud.catalog.markers.map((m) => m.id), cloud.catalog.packs]).toEqual([
      ['cloud:database'],
      ['cloud:flow'],
      undefined,
    ]);
    // without core every registrant is listed, as before
    expect(buildCatalog(r).catalog.packs).toBeUndefined();
    expect(buildCatalog(r).catalog.shapes.map((s) => s.id)).toEqual(['basic:star', 'cloud:database', 'lucide:x']);
  });

  it('FR-AI-002: an entry with no describe is still listed, with a diagnostic naming it', () => {
    const r = loaded();
    r.shapeDefs.register('lazy:box', { id: 'lazy:box' } as unknown as ShapeDef, 'lazy');
    const { catalog, diagnostics } = buildCatalog(r);
    expect(catalog.shapes.find((s) => s.id === 'lazy:box')?.describe).toBe('');
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'FLX_REGISTRY_UNDESCRIBED', path: '/catalog/shapes/lazy:box' })]);
  });

  it('FR-AI-002: a host that requires describe refuses a shape without one, and a multi-line or overlong line', () => {
    const r = loaded(true);
    const refused = r.shapeDefs.register('lazy:box', { id: 'lazy:box' } as unknown as ShapeDef, 'lazy');
    expect(refused.ok ? undefined : refused.error.code).toBe('FLX_REGISTRY_UNDESCRIBED');
    for (const describe of ['two\nlines', 'x'.repeat(161), '   ']) {
      const bad = r.shapeDefs.register('lazy:bad', { id: 'lazy:bad', describe } as unknown as ShapeDef, 'lazy');
      expect(bad.ok).toBe(false);
    }
    expect(r.shapeDefs.get('lazy:box')).toBeUndefined();
  });
});
