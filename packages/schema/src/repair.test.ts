import { describe, expect, it } from 'vitest';
import type { RawDocument } from './migrate.js';
import { repair } from './repair.js';
import { parseDocument } from './serialize.js';
import { validate } from './validate.js';

const box = { x: 0, y: 0, w: 10, h: 10 };
const broken: RawDocument = {
  schemaVersion: '1.0',
  records: {
    doc: { id: 'doc', type: 'document' },
    s1: { id: 's1', type: 'screen', index: 'a0', size: { w: 800, h: 600 } },
    a: { id: 'a', type: 'element', screenId: 's1', index: 'a0', kind: 'shape', defId: 'basic:rect', transform: box },
    b: { id: 'b', type: 'element', screenId: 's1', index: 'a0', kind: 'shape', defId: 'basic:rect', transform: box },
    n: { id: 'n', type: 'element', screenId: 's1', kind: 'shape', defId: 'basic:rect', transform: box },
    o: { id: 'o', type: 'element', screenId: 's1', parentId: 'gone', index: 'a0', kind: 'shape', defId: 'basic:rect', transform: box },
    c: { id: 'c', type: 'element', screenId: 's1', index: 'a5', kind: 'connector', route: { type: 'straight' } },
    bs: { id: 'bs', type: 'binding', connectorId: 'c', end: 'source', elementId: 'a', anchor: { kind: 'auto' } },
    bt: { id: 'bt', type: 'binding', connectorId: 'c', end: 'target', elementId: 'deleted', anchor: { kind: 'auto' } },
    g1: { id: 'g1', type: 'element', screenId: 's1', parentId: 'g2', index: 'a6', kind: 'group', transform: box },
    g2: { id: 'g2', type: 'element', screenId: 's1', parentId: 'g1', index: 'a7', kind: 'group', transform: box },
    junk: 7,
  },
};

describe('lenient repair (FR-DOC-003)', () => {
  it('FR-DOC-003: repairs dangling bindings, dangling or cyclic parents and bad indices, each with a warning', () => {
    const r = repair(broken);
    expect(r.diagnostics.map((d) => `${d.code} ${d.path}`)).toEqual([
      'FLX_REPAIRED_BINDING /records/bt',
      'FLX_REPAIRED_PARENT /records/g1/parentId',
      'FLX_REPAIRED_PARENT /records/o/parentId',
      'FLX_REPAIRED_INDEX /records/b/index',
      'FLX_REPAIRED_INDEX /records/n/index',
      'FLX_REPAIRED_INDEX /records/o/index',
    ]);
    for (const d of r.diagnostics) expect(d.severity).toBe('warning');
    const recs = r.document.records;
    const field = (id: string, key: string): unknown => (recs[id] as { readonly [k: string]: unknown } | undefined)?.[key];
    expect(recs['bt']).toBeUndefined();
    expect(field('c', 'freeTarget')).toEqual({ x: 400, y: 300 });
    expect(field('o', 'parentId')).toBeUndefined();
    expect(field('g1', 'parentId')).toBeUndefined();
    expect(field('g2', 'parentId')).toBe('g1');
    const indices = ['a', 'b', 'n', 'o', 'c'].map((id) => String(field(id, 'index')));
    expect(new Set(indices).size).toBe(5);
    expect(recs['junk']).toBe(7);
    // everything repair can fix is fixed; the non-object record is left for validate
    expect(validate(r.document).map((d) => d.code)).toEqual(['FLX_SCHEMA_INVALID']);
  });

  it('is pure and leaves a sound document unchanged', () => {
    const before = JSON.stringify(broken);
    repair(broken);
    expect(JSON.stringify(broken)).toBe(before);
    const sound: RawDocument = { schemaVersion: '1.0', records: { doc: { id: 'doc', type: 'document' }, s1: { id: 's1', type: 'screen', index: 'a0' } } };
    expect(repair(sound)).toEqual({ document: sound, diagnostics: [] });
  });

  it('FR-DOC-003: parseDocument repairs on load and reports each repair as a warning', () => {
    const doc = {
      schemaVersion: '1.0',
      records: {
        doc: { id: 'doc', type: 'document' },
        s1: { id: 's1', type: 'screen', index: 'a0' },
        c: { id: 'c', type: 'element', screenId: 's1', index: 'a0', kind: 'connector', route: { type: 'straight' }, freeTarget: { x: 1, y: 1 } },
        b: { id: 'b', type: 'binding', connectorId: 'c', end: 'source', elementId: 'gone', anchor: { kind: 'auto' } },
      },
    };
    const r = parseDocument(JSON.stringify(doc));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.diagnostics.map((d) => d.code)).toEqual(['FLX_REPAIRED_BINDING']);
    expect(r.value.document.records['b']).toBeUndefined();
    expect(r.value.document.records['c']).toMatchObject({ freeSource: { x: 960, y: 540 } });
    const old = parseDocument(JSON.stringify({ ...doc, schemaVersion: '0.9' }));
    expect(old.ok ? [] : old.error.diagnostics.map((d) => d.code)).toContain('FLX_VERSION_UNSUPPORTED');
  });

  it('NFR-REL-002: records that are null or an array are reported, never repaired or thrown on (M2.12 review)', () => {
    for (const records of [null, [{ id: 'doc', type: 'document' }], 'x']) {
      const r = parseDocument(JSON.stringify({ schemaVersion: '1.0', records }));
      expect(r.ok ? [] : r.error.diagnostics.map((d) => d.code), JSON.stringify(records)).toEqual(['FLX_RECORDS_INVALID']);
    }
  });

  it('frees an end at the viewport centre of an infinite screen, and not when another binding still holds it (M2.12 review r2)', () => {
    const doc: RawDocument = {
      schemaVersion: '1.0',
      records: {
        doc: { id: 'doc', type: 'document' },
        s1: { id: 's1', type: 'screen', index: 'a0', kind: 'infinite', viewport: { x: 10000, y: 5000, w: 1000, h: 800 } },
        a: { id: 'a', type: 'element', screenId: 's1', index: 'a0', kind: 'shape', defId: 'basic:rect', transform: box },
        c: { id: 'c', type: 'element', screenId: 's1', index: 'a1', kind: 'connector', route: { type: 'straight' } },
        b1: { id: 'b1', type: 'binding', connectorId: 'c', end: 'source', elementId: 'a', anchor: { kind: 'auto' } },
        b2: { id: 'b2', type: 'binding', connectorId: 'c', end: 'source', elementId: 'gone', anchor: { kind: 'auto' } },
        b3: { id: 'b3', type: 'binding', connectorId: 'c', end: 'target', elementId: 'gone', anchor: { kind: 'auto' } },
      },
    };
    const c = repair(doc).document.records['c'] as { readonly [k: string]: unknown };
    expect(c['freeSource']).toBeUndefined();
    expect(c['freeTarget']).toEqual({ x: 10500, y: 5400 });
  });

  it('a removed binding with a corrupted end frees neither end (M2.14 review r3)', () => {
    const r = repair({
      schemaVersion: '1.0',
      records: {
        s1: { id: 's1', type: 'screen', index: 'a0' },
        c: { id: 'c', type: 'element', screenId: 's1', index: 'a0', kind: 'connector', route: { type: 'straight' }, freeTarget: { x: 1, y: 1 } },
        bx: { id: 'bx', type: 'binding', connectorId: 'c', end: 'middle', elementId: 'gone', anchor: { kind: 'auto' } },
      },
    });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['FLX_REPAIRED_BINDING']);
    expect(r.document.records['c']).not.toHaveProperty('freeSource');
    expect(r.document.records['bx']).toBeUndefined();
  });
});
