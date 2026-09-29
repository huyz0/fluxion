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
});
