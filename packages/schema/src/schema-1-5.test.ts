// Schema 1.5 (ADR-0168, FR-CON-007): curve tangents and the jump style on a connector's route.
import { describe, expect, it } from 'vitest';
import nonconforming from './__fixtures__/migration/nonconforming-1.4.flux.json' with { type: 'json' };
import v14 from './__fixtures__/v1.4/document.flux.json' with { type: 'json' };
// the 1.5 routes are unchanged in the current fixture
import v15 from './__fixtures__/v1.7/document.flux.json' with { type: 'json' };
import { migrate } from './migrate.js';
import { parseDocument, serializeDocument } from './serialize.js';
import { validate } from './validate.js';

type Fields = { readonly [key: string]: unknown };
const records = (doc: { records: object }) => doc.records as { readonly [id: string]: Fields };
const withRoute = (route: unknown) => ({ ...v15, records: { ...v15.records, c1: { ...records(v15)['c1'], route } } });
const codes = (doc: unknown) => validate(doc).map((d) => `${d.code} ${d.path}`);

describe('schema 1.5 (FR-CON-007)', () => {
  it('FR-CON-007: a 1.4 document migrates to a valid 1.5 one with its records unchanged and round-trips', () => {
    const r = migrate(v14);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.applied).toEqual(['1.4→1.5', '1.5→1.6', '1.6→1.7']);
    expect(r.value.document.schemaVersion).toBe('1.7');
    expect(r.value.document.records).toEqual(v14.records);
    expect(validate(r.value.document)).toEqual([]);
    const again = parseDocument(serializeDocument(r.value.document as never));
    expect(again.ok && again.value.document).toEqual(r.value.document);
  });

  it('FR-CON-007: the 1.5 fixture holds a curved route with tangents and a jump style, validates and round-trips byte for byte', () => {
    expect(validate(v15)).toEqual([]);
    expect(records(v15)['c1']?.['route']).toEqual({ type: 'curved', jumps: 'gap', tangents: { '0': { x: 40, y: -30 }, '1': { x: -40, y: 30 } } });
    const r = parseDocument(JSON.stringify(v15));
    if (!r.ok) throw new Error(r.error.message);
    expect(JSON.parse(serializeDocument(r.value.document))).toEqual(v15);
  });

  it('FR-CON-007: a 1.4 route with tangents or jumps the typed fields refuse migrates to a valid 1.5 one', () => {
    expect(validate({ ...nonconforming, schemaVersion: '1.6' }).filter((d) => d.severity === 'error').length).toBeGreaterThan(0);
    const r = migrate(nonconforming);
    if (!r.ok) throw new Error(r.error.message);
    expect(validate(r.value.document)).toEqual([]);
    // the bad fields go; the others stay
    expect(records(r.value.document)['c1']?.['route']).toEqual({ type: 'curved', cornerRadius: 4 });
  });

  it('FR-CON-007: tangents must be points keyed by a point index and jumps one of arc, gap or none, each an error at its path', () => {
    expect(codes(withRoute({ type: 'curved', tangents: { '0': { x: 1, y: 2 } } }))).toEqual([]);
    for (const jumps of ['arc', 'gap', 'none']) expect(codes(withRoute({ type: 'curved', jumps }))).toEqual([]);
    expect(codes(withRoute({ type: 'curved', jumps: 'wavy' }))).toContain('FLX_SCHEMA_INVALID /records/c1/route/jumps');
    expect(codes(withRoute({ type: 'curved', tangents: { first: { x: 1, y: 2 } } })).length).toBeGreaterThan(0);
    expect(codes(withRoute({ type: 'curved', tangents: { '0': { x: 1 } } })).length).toBeGreaterThan(0);
  });

  it('FR-DOC-005: tangent offsets are written on the same 1e-3 grid as the other geometry', () => {
    const noisy = withRoute({ type: 'curved', tangents: { '0': { x: 37.82842712474619, y: -0.0004 } } });
    const r = parseDocument(JSON.stringify(noisy));
    if (!r.ok) throw new Error(r.error.message);
    const route = records(JSON.parse(serializeDocument(r.value.document)))['c1']?.['route'] as { tangents: Record<string, unknown> };
    expect(route.tangents['0']).toEqual({ x: 37.828, y: 0 });
  });
});
