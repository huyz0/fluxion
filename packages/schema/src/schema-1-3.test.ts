// Schema 1.3 (ADR-0031): layout specs on screens, groups and frames, and the FluxScript a document was compiled from.
import { describe, expect, it } from 'vitest';
import nonconforming from './__fixtures__/migration/nonconforming-1.2.flux.json' with { type: 'json' };
import v12 from './__fixtures__/v1.2/document.flux.json' with { type: 'json' };
import v13 from './__fixtures__/v1.3/document.flux.json' with { type: 'json' };
import { migrate } from './migrate.js';
import { parseDocument, serializeDocument } from './serialize.js';
import { validate } from './validate.js';

type Fields = { readonly [key: string]: unknown };
const records = (doc: { records: object }) => doc.records as { readonly [id: string]: Fields };
const withRecord = (id: string, patch: Fields) => ({ ...v13, records: { ...v13.records, [id]: { ...records(v13)[id], ...patch } } });
const codes = (doc: unknown) => validate(doc).map((d) => `${d.code} ${d.path}`);

describe('schema 1.3 (FR-DSL-005, FR-DSL-002)', () => {
  it('FR-DSL-005: a 1.2 document migrates to a valid 1.3 one and round-trips', () => {
    const r = migrate(v12);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.applied).toEqual(['1.2→1.3']);
    expect(r.value.document.schemaVersion).toBe('1.3');
    // nothing to add: every new field is optional
    expect(r.value.document.records).toEqual(v12.records);
    expect(validate(r.value.document)).toEqual([]);
    const again = parseDocument(serializeDocument(r.value.document as never));
    expect(again.ok && again.value.document).toEqual(r.value.document);
  });

  it('FR-DSL-005: a 1.2 document with non-conforming layout or source values migrates to a valid 1.3 one', () => {
    // read as 1.3 without the step, the same values are errors
    expect(validate({ ...nonconforming, schemaVersion: '1.3' }).filter((d) => d.severity === 'error').length).toBeGreaterThan(0);
    const r = migrate(nonconforming);
    if (!r.ok) throw new Error(r.error.message);
    expect(validate(r.value.document)).toEqual([]);
    const out = records(r.value.document);
    // a bad name, a string and options that are not an object go; so does a source of another grammar version
    expect('layout' in (out['s1'] ?? {})).toBe(false);
    expect('layout' in (out['s2'] ?? {})).toBe(false);
    expect('layout' in (out['g1'] ?? {})).toBe(false);
    expect('source' in (out['doc'] ?? {})).toBe(false);
    // a shape is not a container: whatever it carries under `layout` is an unknown field, kept (FR-DOC-005)
    expect(out['e1']?.['layout']).toEqual({ type: 'Anything Goes' });
  });

  it("FR-DSL-005: screen.layout and a group's and a frame's layout round-trip and must name a layout", () => {
    expect(validate(v13)).toEqual([]);
    const r = parseDocument(JSON.stringify(v13));
    if (!r.ok) throw new Error(r.error.message);
    expect(records(r.value.document)['s1']?.['layout']).toEqual({ type: 'stack', options: { direction: 'down', gap: 24 } });
    expect(records(r.value.document)['s2']?.['layout']).toEqual({ type: 'layouts-core:layered' });
    expect(records(r.value.document)['g1']?.['layout']).toEqual({ type: 'stack', options: { direction: 'right' } });
    // a frame takes one too
    const frame = { ...records(v13)['g1'], kind: 'frame', clip: true, layout: { type: 'stack' } };
    expect(validate(withRecord('g1', frame))).toEqual([]);
    // a name that is no layout name, a missing type and options that are not an object are errors at their path
    expect(codes(withRecord('s1', { layout: { type: 'Stack Me' } }))).toContain('FLX_SCHEMA_INVALID /records/s1/layout/type');
    expect(codes(withRecord('s1', { layout: { options: {} } }))).toContain('FLX_SCHEMA_INVALID /records/s1/layout/type');
    expect(codes(withRecord('g1', { layout: { type: 'stack', options: [1] } }))).toContain('FLX_SCHEMA_INVALID /records/g1/layout/options');
  });

  it('FR-DSL-002: document.source keeps its salt and deferred sections through a round trip', () => {
    const r = parseDocument(JSON.stringify(v13));
    if (!r.ok) throw new Error(r.error.message);
    const source = records(r.value.document)['doc']?.['source'] as { flux: number; salt: string; deferred: { [k: string]: string } };
    expect(source.flux).toBe(1);
    expect(source.salt).toBe('');
    expect(source.deferred['/screens/arch/steps']).toContain('show: [web, api]');
    expect(serializeDocument(r.value.document)).toContain('"/vars": "brand: Acme\\n"');
    // the grammar version is 1, the salt a string, and a key a pointer
    for (const [bad, path] of [
      [{ flux: 2, salt: '', deferred: {} }, '/records/doc/source/flux'],
      [{ flux: 1, deferred: {} }, '/records/doc/source/salt'],
      [{ flux: 1, salt: '', deferred: { vars: 'x' } }, '/records/doc/source/deferred'],
    ] as const) {
      expect(
        codes(withRecord('doc', { source: bad })).some((c) => c.startsWith(`FLX_SCHEMA_INVALID ${path}`)),
        JSON.stringify(bad),
      ).toBe(true);
    }
  });
});
