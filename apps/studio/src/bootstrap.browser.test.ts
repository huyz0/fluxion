import { seededRandom } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { cryptoRandom, openDocument } from './bootstrap.js';
import { exampleNames, loadDocument } from './documents.js';

describe('studio bootstrap (FR-EDT-001, ADR-0017)', () => {
  it('FR-EDT-001: the studio opens a new document or a bundled example with the basic pack registered', () => {
    const fresh = loadDocument('new', seededRandom(1));
    expect(fresh.ok).toBe(true);
    expect(exampleNames()).toContain('shapes-gallery');
    const gallery = loadDocument('example-shapes-gallery', seededRandom(1));
    if (!gallery.ok) throw new Error(gallery.error);
    const opened = openDocument(gallery.value);
    if (!opened.ok) throw new Error(opened.error);
    // the pack's shapes and markers reach the render registries
    expect(opened.value.registries.shapeDefs.get('basic:star')?.id).toBe('basic:star');
    expect(opened.value.registries.markers.get('basic:open-arrow')?.id).toBe('basic:open-arrow');
    expect(opened.value.core.store.get(Object.keys(gallery.value.records)[0] as never)).toBeDefined();
    // unknown ids are refused with a reason
    for (const id of ['nope', 'example-missing']) {
      const r = loadDocument(id, seededRandom(1));
      expect(r.ok ? '' : r.error).toMatch(/There is no document/);
    }
    const n = cryptoRandom.next();
    expect(n >= 0 && n < 1).toBe(true);
  });

  it('FR-LAY-005: the opened document can arrange a screen with the registered layouts, in one undo step', () => {
    const gallery = loadDocument('example-shapes-gallery', seededRandom(1));
    if (!gallery.ok) throw new Error(gallery.error);
    const opened = openDocument(gallery.value);
    if (!opened.ok) throw new Error(opened.error);
    const { core } = opened.value;
    expect(core.registries.layouts.list().map(([id]) => id)).toEqual(['force', 'grid', 'layered', 'mindmap', 'orgchart', 'radial', 'stack', 'tree']);
    const screenId = Object.values(gallery.value.records).find((r) => r.type === 'screen')?.id;
    if (screenId === undefined) throw new Error('the example has no screen');
    for (const algorithm of ['force', 'grid', 'layered', 'mindmap', 'orgchart', 'radial', 'stack', 'tree']) {
      const before = core.store.history.undoDepth;
      const r = core.execute('layout.arrange', { screenId, scope: 'screen', algorithm });
      expect(r.ok, algorithm).toBe(true);
      expect(core.store.history.undoDepth - before, algorithm).toBeLessThanOrEqual(1);
    }
  });
});
