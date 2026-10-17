// Schema 1.4 (ADR-0043): anchor kinds on an AnchorDef.
import { describe, expect, it } from 'vitest';
import nonconforming from './__fixtures__/migration/nonconforming-1.3.flux.json' with { type: 'json' };
import v13 from './__fixtures__/v1.3/document.flux.json' with { type: 'json' };
import v14 from './__fixtures__/v1.4/document.flux.json' with { type: 'json' };
import { migrate } from './migrate.js';
import { anchorDefSchema } from './records/element-schemas.js';
import { parseDocument, serializeDocument } from './serialize.js';
import { validate } from './validate.js';

type Fields = { readonly [key: string]: unknown };
const records = (doc: { records: object }) => doc.records as { readonly [id: string]: Fields };
const withAnchors = (anchors: readonly unknown[]) => ({ ...v14, records: { ...v14.records, e1: { ...records(v14)['e1'], anchors } } });
const codes = (doc: unknown) => validate(doc).map((d) => `${d.code} ${d.path}`);

describe('schema 1.4 (FR-ANC-003)', () => {
  it('FR-ANC-003: a 1.3 document migrates to a valid 1.4 one with its records unchanged and round-trips', () => {
    const r = migrate(v13);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.applied).toEqual(['1.3→1.4']);
    expect(r.value.document.schemaVersion).toBe('1.4');
    expect(r.value.document.records).toEqual(v13.records);
    expect(validate(r.value.document)).toEqual([]);
    const again = parseDocument(serializeDocument(r.value.document as never));
    expect(again.ok && again.value.document).toEqual(r.value.document);
  });

  it('FR-ANC-003: the 1.4 fixture holds an anchor of each kind, validates and round-trips byte for byte', () => {
    expect(validate(v14)).toEqual([]);
    const anchors = records(v14)['e1']?.['anchors'] as readonly { kind?: string }[];
    expect(new Set(anchors.map((a) => a.kind ?? 'fixed'))).toEqual(new Set(['fixed', 'side', 'perimeter', 'center']));
    const r = parseDocument(JSON.stringify(v14));
    if (!r.ok) throw new Error(r.error.message);
    expect(records(r.value.document)['e1']?.['anchors']).toEqual(anchors);
    expect(JSON.parse(serializeDocument(r.value.document))).toEqual(v14);
  });

  it('FR-ANC-003: a 1.3 anchor with a kind, side or t the typed fields refuse migrates to a valid 1.4 one', () => {
    expect(validate({ ...nonconforming, schemaVersion: '1.4' }).filter((d) => d.severity === 'error').length).toBeGreaterThan(0);
    const r = migrate(nonconforming);
    if (!r.ok) throw new Error(r.error.message);
    expect(validate(r.value.document)).toEqual([]);
    const anchors = records(r.value.document)['e1']?.['anchors'] as readonly Fields[];
    // the conforming ones stay as they were; the bad fields go from the others
    expect(anchors[0]).toEqual({ name: 'ok', kind: 'side', side: 'e', t: 0.5 });
    expect(anchors[1]).toEqual({ name: 'bad-kind', x: 0.5, y: 0.5 });
    expect(anchors[2]).toEqual({ name: 'bad-side', x: 0.5, y: 0 });
    expect(anchors[3]).toEqual({ name: 'bad-t', x: 0.5, y: 0 });
    expect(anchors[4]).toEqual({ name: 'keeps', x: 0, y: 0.5, role: 'in' });
  });

  it('FR-ANC-003: a fixed anchor (or one without kind) needs x and y; the other kinds do not', () => {
    expect(anchorDefSchema.safeParse({ name: 'a', x: 0, y: 1 }).success).toBe(true);
    expect(anchorDefSchema.safeParse({ name: 'a', kind: 'fixed', x: 0, y: 1 }).success).toBe(true);
    expect(anchorDefSchema.safeParse({ name: 'a', kind: 'fixed', x: 0 }).success).toBe(false);
    expect(anchorDefSchema.safeParse({ name: 'a' }).success).toBe(false);
    for (const def of [
      { kind: 'center' },
      { kind: 'perimeter' },
      { kind: 'perimeter', t: 0.3 },
      { kind: 'side', side: 'w' },
      { kind: 'side', side: 'w', t: 1 },
    ]) {
      expect(anchorDefSchema.safeParse({ name: 'a', ...def }).success, JSON.stringify(def)).toBe(true);
    }
  });

  it('FR-ANC-003: an unknown kind, a side that is no side, a side anchor without side and t out of range are errors at their path', () => {
    expect(codes(withAnchors([{ name: 'a', kind: 'diagonal', x: 0, y: 0 }]))).toContain('FLX_SCHEMA_INVALID /records/e1/anchors/0/kind');
    expect(codes(withAnchors([{ name: 'a', kind: 'side', side: 'up' }]))).toContain('FLX_SCHEMA_INVALID /records/e1/anchors/0/side');
    expect(codes(withAnchors([{ name: 'a', kind: 'side' }]))).toContain('FLX_SCHEMA_INVALID /records/e1/anchors/0/side');
    expect(codes(withAnchors([{ name: 'a', kind: 'perimeter', t: 1.5 }]))).toContain('FLX_SCHEMA_INVALID /records/e1/anchors/0/t');
    expect(codes(withAnchors([{ name: 'a', kind: 'fixed', x: 0 }]))).toContain('FLX_SCHEMA_INVALID /records/e1/anchors/0/y');
  });
});
