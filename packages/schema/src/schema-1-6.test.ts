// Schema 1.6 (ADR-0046, FR-LAY-010): a layout spec's `live`, which asks for the container to be re-laid out after edits.
import { describe, expect, it } from 'vitest';
import nonconforming from './__fixtures__/migration/nonconforming-1.5.flux.json' with { type: 'json' };
import v12 from './__fixtures__/v1.2/document.flux.json' with { type: 'json' };
import v15 from './__fixtures__/v1.5/document.flux.json' with { type: 'json' };
import v16 from './__fixtures__/v1.6/document.flux.json' with { type: 'json' };
import v17 from './__fixtures__/v1.7/document.flux.json' with { type: 'json' };
import { migrate } from './migrate.js';
import { layoutSpecSchema } from './records/layout-spec.js';
import { parseDocument, serializeDocument } from './serialize.js';
import { validate } from './validate.js';

type Fields = { readonly [key: string]: unknown };
const records = (doc: { records: object }) => doc.records as { readonly [id: string]: Fields };
// on the current fixture, so only the layout is under test
const withLayout = (id: string, layout: unknown) => ({ ...v17, records: { ...v17.records, [id]: { ...records(v17)[id], layout } } });
const codes = (doc: unknown) => validate(doc).map((d) => `${d.code} ${d.path}`);

describe('schema 1.6 (FR-LAY-010)', () => {
  it('FR-LAY-010: a 1.2 layout with a non-boolean live keeps its type and options through every step and loses only live', () => {
    const screen = Object.entries(records(v12)).find(([, r]) => r['type'] === 'screen')?.[0] as string;
    const layout = { type: 'stack', options: { direction: 'down', gap: 24 }, live: 'yes' };
    const r = migrate({ ...v12, records: { ...v12.records, [screen]: { ...records(v12)[screen], layout } } });
    if (!r.ok) throw new Error(r.error.message);
    expect(records(r.value.document)[screen]?.['layout']).toEqual({ type: 'stack', options: { direction: 'down', gap: 24 } });
    expect(validate(r.value.document)).toEqual([]);
  });

  it('FR-LAY-010: a 1.5 document migrates to a valid 1.6 one with its records unchanged and round-trips', () => {
    const r = migrate(v15);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.applied).toEqual(['1.5→1.6', '1.6→1.7']);
    expect(r.value.document.schemaVersion).toBe('1.7');
    expect(r.value.document.records).toEqual(v15.records);
    expect(validate(r.value.document)).toEqual([]);
    const again = parseDocument(serializeDocument(r.value.document as never));
    expect(again.ok && again.value.document).toEqual(r.value.document);
  });

  it('FR-LAY-010: the 1.6 fixture holds a live layout spec, validates once migrated and round-trips', () => {
    const m = migrate(v16);
    if (!m.ok) throw new Error(m.error.message);
    expect(validate(m.value.document)).toEqual([]);
    expect(records(v16)['s2']?.['layout']).toEqual({ type: 'layouts-core:layered', live: true });
    const r = parseDocument(JSON.stringify(v16));
    if (!r.ok) throw new Error(r.error.message);
    expect(JSON.parse(serializeDocument(r.value.document))).toEqual({ ...v16, schemaVersion: '1.7' });
  });

  it('FR-LAY-010: a 1.5 layout spec whose live is not a boolean migrates to a valid 1.6 one without it, keeping a boolean live', () => {
    expect(validate({ ...nonconforming, schemaVersion: '1.6' }).filter((d) => d.severity === 'error').length).toBeGreaterThan(0);
    const r = migrate(nonconforming);
    if (!r.ok) throw new Error(r.error.message);
    expect(validate(r.value.document)).toEqual([]);
    const out = records(r.value.document);
    // the bad live goes, the rest of the spec stays
    expect(out['s1']?.['layout']).toEqual({ type: 'stack', options: { direction: 'down', gap: 24 } });
    expect(out['g1']?.['layout']).toEqual({ type: 'stack', options: { direction: 'right' } });
    expect(out['s2']?.['layout']).toEqual({ type: 'layouts-core:layered', live: false });
  });

  it('FR-LAY-010: live is an optional boolean on a screen or group layout, an error at its path otherwise', () => {
    expect(layoutSpecSchema.safeParse({ type: 'stack', live: true }).success).toBe(true);
    expect(layoutSpecSchema.safeParse({ type: 'stack' }).success).toBe(true);
    expect(layoutSpecSchema.safeParse({ type: 'stack', live: 'yes' }).success).toBe(false);
    expect(codes(withLayout('g1', { type: 'stack', live: false }))).toEqual([]);
    expect(codes(withLayout('s1', { type: 'stack', live: 1 }))).toContain('FLX_SCHEMA_INVALID /records/s1/layout/live');
    expect(codes(withLayout('g1', { type: 'stack', live: null }))).toContain('FLX_SCHEMA_INVALID /records/g1/layout/live');
  });
});
