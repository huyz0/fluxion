import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { repair } from './repair.js';
import { MAX_JSON_DEPTH, parseDocument, serializeDocument } from './serialize.js';
import { arbDocument } from './testing/arbitraries.js';
import { validate } from './validate.js';

/** Ways a stored document gets damaged: truncation, byte edits, spliced garbage, random JSON. */
const corrupted: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: 'binary' }),
  fc.jsonValue().map((v) => JSON.stringify(v)),
  fc.tuple(arbDocument, fc.nat(), fc.nat()).map(([doc, a, b]) => {
    const t = serializeDocument(doc);
    return t.slice(0, a % (t.length + 1)) + t.slice(b % (t.length + 1));
  }),
  fc.tuple(arbDocument, fc.nat(), fc.string({ maxLength: 8 })).map(([doc, at, junk]) => {
    const t = serializeDocument(doc);
    const i = at % (t.length + 1);
    return t.slice(0, i) + junk + t.slice(i);
  }),
  fc.tuple(arbDocument, fc.nat(), fc.jsonValue()).map(([doc, pick, value]) => {
    const ids = Object.keys(doc.records);
    const id = ids[pick % ids.length] ?? 'x';
    return JSON.stringify({ ...doc, records: { ...doc.records, [id]: value } });
  }),
);

type Records = { readonly [id: string]: { readonly [k: string]: unknown } | undefined };

/**
 * After dropping element `id`: bindings on it (either end) go too, connectors that lost a binding
 * may gain a free end, everything else is kept verbatim.
 */
function expectSalvaged(before: Records, after: Records, id: string): void {
  const onIt = (r: Records[string]) => r?.['type'] === 'binding' && (r['elementId'] === id || r['connectorId'] === id);
  const touched = new Set(
    Object.values(before)
      .filter(onIt)
      .map((b) => String(b?.['connectorId'])),
  );
  for (const [k, rec] of Object.entries(before)) {
    if (k === id || onIt(rec)) expect(after[k]).toBeUndefined();
    else if (touched.has(k)) expect(after[k]).toMatchObject({ id: k, kind: 'connector' });
    else expect(after[k]).toEqual(rec);
  }
}

describe('robust parse (NFR-REL-002)', () => {
  it('NFR-REL-002: a version spelled "1.00" (a corrupted "1.0") is refused, not read as the current one', () => {
    for (const version of ['1.00', '01.0']) {
      const r = parseDocument(`{"schemaVersion":"${version}","records":{}}`);
      expect(r.ok, version).toBe(false);
    }
  });

  it('NFR-REL-002: parse never throws on corrupted input', () => {
    let runs = 0;
    fc.assert(
      fc.property(corrupted, (text) => {
        runs++;
        const r = parseDocument(text);
        // either a document, or a structured error with diagnostics that carry paths
        if (r.ok) expect(r.value.document.schemaVersion).toBe('1.0');
        else expect(r.error.diagnostics.length).toBeGreaterThan(0);
      }),
    );
    // the global run count (FC_RUNS; 10 000 at the milestone gate) really reached this property
    expect(runs).toBe(fc.readConfigureGlobal().numRuns);
    // ~5 s at 10 000 runs on a laptop; slow CI runners get room
  }, 120_000);

  it('NFR-REL-002: a doc with one broken record salvages the rest', () => {
    fc.assert(
      fc.property(arbDocument, fc.nat(), (doc, pick) => {
        const ids = Object.keys(doc.records).filter((id) => doc.records[id]?.type === 'element');
        const id = ids[pick % Math.max(1, ids.length)];
        if (id === undefined) return;
        const broken = { ...doc, records: { ...doc.records, [id]: { ...doc.records[id], screenId: 42 } } };
        const r = parseDocument(JSON.stringify(broken));
        expect(r.ok).toBe(false);
        if (r.ok) return;
        const salvaged = r.error.salvaged;
        expect(salvaged?.records[id]).toBeUndefined();
        expectSalvaged(doc.records, salvaged?.records ?? {}, id);
      }),
    );
  }, 120_000);

  it('NFR-REL-002: salvage drops what depends on a dropped record, so the rest validates (M2.14 review F2)', () => {
    fc.assert(
      fc.property(arbDocument, fc.nat(), (doc, pick) => {
        const screens = Object.keys(doc.records).filter((id) => doc.records[id]?.type === 'screen');
        const id = screens[pick % screens.length] ?? '';
        const broken = { ...doc, records: { ...doc.records, [id]: { ...doc.records[id], size: { w: 'x', h: 1 } } } };
        const r = parseDocument(JSON.stringify(broken));
        expect(r.ok).toBe(false);
        if (r.ok) return;
        const salvaged = r.error.salvaged;
        expect(salvaged).not.toBeNull();
        if (salvaged === null) return;
        expect(salvaged.records[id]).toBeUndefined();
        expect(Object.values(salvaged.records).some((x) => x['screenId'] === id)).toBe(false);
        expect(validate(salvaged).filter((d) => d.severity === 'error')).toEqual([]);
      }),
    );
  }, 120_000);

  it('NFR-REL-002: a broken binding is dropped and its connector kept with a free end (M2.14 review r2)', () => {
    fc.assert(
      fc.property(arbDocument, fc.nat(), (doc, pick) => {
        const bindings = Object.keys(doc.records).filter((id) => doc.records[id]?.type === 'binding');
        const id = bindings[pick % Math.max(1, bindings.length)];
        if (id === undefined) return;
        const binding = doc.records[id] as { readonly [k: string]: unknown };
        const broken = { ...doc, records: { ...doc.records, [id]: { ...binding, anchor: { kind: 'bogus' } } } };
        const r = parseDocument(JSON.stringify(broken));
        expect(r.ok).toBe(false);
        if (r.ok) return;
        const salvaged = r.error.salvaged;
        expect(salvaged?.records[id]).toBeUndefined();
        const free = binding['end'] === 'target' ? 'freeTarget' : 'freeSource';
        expect(salvaged?.records[String(binding['connectorId'])]).toHaveProperty(free);
        expect(Object.keys(salvaged?.records ?? {}).sort()).toEqual(
          Object.keys(doc.records)
            .filter((k) => k !== id)
            .sort(),
        );
        expect(validate(salvaged).filter((d) => d.severity === 'error')).toEqual([]);
      }),
    );
  }, 120_000);

  it('repairs 30 000 dangling bindings in linear time (M2.14 review F1)', () => {
    const records: { [id: string]: unknown } = { doc: { id: 'doc', type: 'document' }, s1: { id: 's1', type: 'screen', index: 'a0' } };
    for (let i = 0; i < 30_000; i++) {
      records[`c${i}`] = {
        id: `c${i}`,
        type: 'element',
        screenId: 's1',
        index: `a${i}`,
        kind: 'connector',
        route: { type: 'straight' },
        freeTarget: { x: 0, y: 0 },
      };
      records[`b${i}`] = { id: `b${i}`, type: 'binding', connectorId: `c${i}`, end: 'source', elementId: 'gone', anchor: { kind: 'auto' } };
    }
    const r = repair({ schemaVersion: '1.0', records });
    expect(r.diagnostics.filter((d) => d.code === 'FLX_REPAIRED_BINDING')).toHaveLength(30_000);
  }, 30_000);

  it('NFR-REL-002: hostile nesting is reported, not a stack overflow', () => {
    const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    const r = parseDocument(`{"schemaVersion":"1.0","records":{"doc":{"id":"doc","type":"document","x":${deep}}}}`);
    expect(r.ok ? [] : r.error.diagnostics.map((d) => d.code)).toEqual(['FLX_JSON_TOO_DEEP']);
    expect(r.ok ? 'ok' : r.error.salvaged).toBeNull();
    const fine = `${'['.repeat(MAX_JSON_DEPTH - 8)}${']'.repeat(MAX_JSON_DEPTH - 8)}`;
    expect(parseDocument(`{"schemaVersion":"1.0","records":{"doc":{"id":"doc","type":"document","x":${fine}}}}`).ok).toBe(true);
  });

  it('salvage is null when nothing structural is left', () => {
    for (const text of ['', 'null', '[]', '{"schemaVersion":"1.0"}', '{"records":{}}']) {
      const r = parseDocument(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) expect(r.error.salvaged, text).toBeNull();
    }
  });
});
