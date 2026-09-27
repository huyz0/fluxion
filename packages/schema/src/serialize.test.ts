import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type DocumentFile, documentFileSchema } from './document-file.js';
import { canonicalNumber, parseDocument, serializeDocument } from './serialize.js';

const text = (s: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] });
const base = {
  schemaVersion: '1.0',
  records: {
    doc: { id: 'doc', type: 'document', title: 'Checkout' },
    s1: { id: 's1', type: 'screen', index: 'a0', name: 'Main' },
    e1: {
      id: 'e1',
      type: 'element',
      screenId: 's1',
      index: 'a0',
      kind: 'shape',
      defId: 'basic:rect',
      transform: { x: 10.5, y: 20, w: 100, h: 50, rot: 15 },
      text: text('API'),
    },
    e2: { id: 'e2', type: 'element', screenId: 's1', index: 'a1', kind: 'shape', defId: 'basic:rect', transform: { x: 300, y: 20, w: 100, h: 50 } },
    c1: { id: 'c1', type: 'element', screenId: 's1', index: 'a2', kind: 'connector', route: { type: 'straight' }, freeTarget: { x: 1, y: 2 } },
    b1: { id: 'b1', type: 'binding', connectorId: 'c1', end: 'source', elementId: 'e1', anchor: { kind: 'auto' } },
  },
} as const;

/** A test value typed as a document by parsing it (no casts on data, coding rule 9). */
const asDoc = (v: unknown): DocumentFile => documentFileSchema.parse(v);

const parsed = (t: string): DocumentFile => {
  const r = parseDocument(t);
  if (!r.ok) throw new Error(JSON.stringify(r.error.diagnostics));
  return r.value.document;
};

// JSON extras on the canonical grid: what a newer version or a plugin could add to any record
const gridNumber = fc.integer({ min: -1e9, max: 1e9 }).map((n) => n / 1000);
const extra = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.string(),
    gridNumber,
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('value'), { maxLength: 3 }),
    fc.dictionary(fc.string(), tie('value'), { maxKeys: 3 }),
  ),
})).value;
const withExtras = fc
  .dictionary(
    fc.constantFrom('doc', 's1', 'e1', 'e2', 'c1', 'b1'),
    fc.dictionary(
      fc.string().map((k) => `x-${k}`),
      extra,
      { maxKeys: 3 },
    ),
  )
  .map((adds) => ({
    ...base,
    records: Object.fromEntries(Object.entries(base.records).map(([id, r]) => [id, { ...r, ...(adds[id] ?? {}) }])),
  }));

describe('canonical serialization', () => {
  it('FR-DOC-001: parse(serialize(doc)) deep-equals doc', () => {
    fc.assert(
      fc.property(withExtras, (doc) => {
        expect(parsed(serializeDocument(asDoc(doc)))).toEqual(doc);
      }),
    );
  });

  it('NFR-REL-005: serializing twice is byte-identical, whatever the key order', () => {
    fc.assert(
      fc.property(withExtras, (doc) => {
        const once = serializeDocument(asDoc(doc));
        expect(serializeDocument(parsed(once))).toBe(once);
        // same content, every record and every record's keys in reverse order
        const reversed = {
          records: Object.fromEntries(
            Object.entries(doc.records)
              .reverse()
              .map(([id, r]) => [id, Object.fromEntries(Object.entries(r).reverse())]),
          ),
          schemaVersion: doc.schemaVersion,
        };
        expect(serializeDocument(asDoc(reversed))).toBe(once);
      }),
    );
  });

  it('writes sorted keys, 2-space indent, LF and a trailing newline', () => {
    const out = serializeDocument(asDoc({ schemaVersion: '1.0', records: { b: { id: 'b', type: 'document' }, a: { type: 'hologram', id: 'a' } } }));
    expect(out).toBe(
      '{\n  "records": {\n    "a": {\n      "id": "a",\n      "type": "hologram"\n    },\n    "b": {\n      "id": "b",\n      "type": "document"\n    }\n  },\n  "schemaVersion": "1.0"\n}\n',
    );
    expect(out.includes('\r')).toBe(false);
  });

  it('drops undefined fields and writes undefined array items as null, like JSON', () => {
    const doc = asDoc({ ...base, records: { ...base.records, doc: { ...base.records.doc, gone: undefined, list: [1, undefined, 'x'] } } });
    const out = serializeDocument(doc);
    expect(out).not.toContain('gone');
    expect(out).toContain('"list": [\n        1,\n        null,\n        "x"\n      ]');
  });

  it('NFR-REL-005: rounding is idempotent for every double and never turns a finite number infinite', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (n) => {
        const once = canonicalNumber(n);
        expect(canonicalNumber(once)).toBe(once);
        expect(Number.isFinite(once)).toBe(Number.isFinite(n));
      }),
    );
    expect(canonicalNumber(-4498578594957.645)).toBe(-4498578594957.645);
    expect(canonicalNumber(1e306)).toBe(1e306);
  });

  it('FR-DOC-005: rounds only geometry fields; every other number is written exactly (M2.9 review r2)', () => {
    const doc = asDoc({
      schemaVersion: '1.0',
      records: {
        doc: { id: 'doc', type: 'document', ratio: 0.12345 },
        s1: {
          id: 's1',
          type: 'screen',
          index: 'a0',
          kind: 'infinite',
          size: { w: 800.0004, h: 600 },
          viewport: { x: 0.1234, y: 0, w: 10.0006, h: 10, zoom: 1.23456 },
        },
        c: {
          id: 'c',
          type: 'element',
          screenId: 's1',
          index: 'a0',
          kind: 'connector',
          route: { type: 'polyline', waypoints: [{ x: 1.23456, y: 2 }], tension: 0.33333 },
          freeSource: { x: 0.0004, y: 1 },
          freeTarget: { x: 5.5555, y: 1 },
          labels: [{ position: 0.33333, offset: { x: 1.00049, y: 0 }, text: { type: 'doc', content: [{ type: 'paragraph' }] } }],
          props: { lat: 51.50735 },
        },
        g: {
          id: 'g',
          type: 'element',
          screenId: 's1',
          index: 'a1',
          kind: 'acme:gauge',
          transform: { x: 1.0001, y: 0, w: 1, h: 1, rot: 12.34567, skew: 0.12345 },
          props: { v: 0.9999 },
        },
      },
    });
    const out = JSON.parse(serializeDocument(doc));
    expect(out.records.s1.size.w).toBe(800);
    expect(out.records.s1.viewport).toEqual({ x: 0.123, y: 0, w: 10.001, h: 10, zoom: 1.23456 });
    expect(out.records.c.route).toEqual({ type: 'polyline', waypoints: [{ x: 1.235, y: 2 }], tension: 0.33333 });
    expect([out.records.c.freeSource.x, out.records.c.freeTarget.x]).toEqual([0, 5.556]);
    expect(out.records.c.labels[0].position).toBe(0.33333);
    expect(out.records.c.labels[0].offset.x).toBe(1);
    expect(out.records.g.transform).toEqual({ x: 1, y: 0, w: 1, h: 1, rot: 12.346, skew: 0.12345 });
    expect([out.records.doc.ratio, out.records.c.props.lat, out.records.g.props.v]).toEqual([0.12345, 51.50735, 0.9999]);
  });

  it('rounds numbers to 1e-3 and writes -0 as 0', () => {
    expect(canonicalNumber(1.23456)).toBe(1.235);
    expect(canonicalNumber(-0.0001)).toBe(0);
    expect(Object.is(canonicalNumber(-0), 0)).toBe(true);
    expect(canonicalNumber(1e21)).toBe(1e21);
    const doc = { ...base, records: { ...base.records, e2: { ...base.records.e2, transform: { x: -0, y: 0.0004, w: 99.99951, h: 1 / 3 } } } };
    expect(serializeDocument(asDoc(doc))).toContain('"transform": {\n        "h": 0.333,\n        "w": 100,\n        "x": 0,\n        "y": 0\n      }');
  });

  it('FR-DOC-004: parse reports invalid JSON and invalid documents as diagnostics, never throws', () => {
    expect(parseDocument('{ nope')).toMatchObject({
      ok: false,
      error: { code: 'DOCUMENT_JSON_INVALID', diagnostics: [{ code: 'FLX_JSON_INVALID', severity: 'error', path: '' }] },
    });
    const bad = parseDocument(JSON.stringify({ ...base, records: { ...base.records, e2: { ...base.records.e2, defId: 'rect' } } }));
    expect(bad.ok ? [] : [bad.error.code, ...bad.error.diagnostics.map((d) => d.path)]).toEqual(['DOCUMENT_INVALID', '/records/e2/defId']);
    const warn = parseDocument(JSON.stringify({ ...base, schemaVersion: '1.4' }));
    expect(warn.ok && warn.value.diagnostics.map((d) => d.code)).toEqual(['FLX_VERSION_NEWER']);
  });

  it('FR-DOC-001: a "__proto__" key in unknown data survives serialize and parse (M2.11 review F1)', () => {
    const text = '{"schemaVersion":"1.0","records":{"doc":{"id":"doc","type":"document","x-meta":{"__proto__":{"a":1},"b":2,"c":{"__proto__":"x"}}}}}';
    const once = serializeDocument(parsed(text));
    expect(once).toContain('"__proto__": {');
    expect(once).toContain('"__proto__": "x"');
    expect(serializeDocument(parsed(once))).toBe(once);
    expect(parsed(once)).toEqual(parsed(text));
  });
});
