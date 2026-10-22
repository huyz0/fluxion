// Schema 1.7 (ADR-0047, FR-LAY-014): a layout spec of type `template` names its template (`id`) and the items it was built from (`items`).
import { describe, expect, it } from 'vitest';
import nonconforming from './__fixtures__/migration/nonconforming-1.6.flux.json' with { type: 'json' };
import v16 from './__fixtures__/v1.6/document.flux.json' with { type: 'json' };
import v17 from './__fixtures__/v1.7/document.flux.json' with { type: 'json' };
import { migrate } from './migrate.js';
import { layoutSpecSchema, MAX_TEMPLATE_DEPTH, templateItemSchema } from './records/layout-spec.js';
import { parseDocument, serializeDocument } from './serialize.js';
import { validate } from './validate.js';

type Fields = { readonly [key: string]: unknown };
const records = (doc: { records: object }) => doc.records as { readonly [id: string]: Fields };
const withLayout = (id: string, layout: unknown) => ({ ...v17, records: { ...v17.records, [id]: { ...records(v17)[id], layout } } });
const codes = (doc: unknown) => validate(doc).map((d) => `${d.code} ${d.path}`);
const parses = (spec: unknown) => layoutSpecSchema.safeParse(spec).success;

describe('schema 1.7 (FR-LAY-014)', () => {
  it('FR-LAY-014: a 1.6 document migrates to a valid 1.7 one with its records unchanged and round-trips', () => {
    const r = migrate(v16);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.applied).toEqual(['1.6→1.7']);
    expect(r.value.document.schemaVersion).toBe('1.7');
    expect(r.value.document.records).toEqual(v16.records);
    expect(validate(r.value.document)).toEqual([]);
    const again = parseDocument(serializeDocument(r.value.document as never));
    expect(again.ok && again.value.document).toEqual(r.value.document);
  });

  it('FR-LAY-014: the 1.7 fixture holds a template layout spec with nested items, validates and round-trips', () => {
    expect(validate(v17)).toEqual([]);
    expect(records(v17)['s3']?.['layout']).toMatchObject({ type: 'template', id: 'process.chevron', options: { direction: 'right' } });
    const r = parseDocument(JSON.stringify(v17));
    if (!r.ok) throw new Error(r.error.message);
    expect(JSON.parse(serializeDocument(r.value.document))).toEqual(v17);
  });

  it('FR-LAY-014: a 1.6 template spec that cannot be built again is removed, and a non-conforming id or items leaves its spec', () => {
    expect(validate({ ...nonconforming, schemaVersion: '1.7' }).filter((d) => d.severity === 'error').length).toBeGreaterThan(0);
    const r = migrate(nonconforming);
    if (!r.ok) throw new Error(r.error.message);
    expect(validate(r.value.document)).toEqual([]);
    const out = records(r.value.document);
    const before = records(nonconforming);
    // no items, no id, an id that is no template id: nothing can build them again
    for (const id of ['g1', 's2', 's4']) expect(out[id] && 'layout' in out[id]).toBe(false);
    // a stray id or items on another layout goes, the rest of the spec stays
    expect(out['s1']?.['layout']).toEqual({ type: 'stack', options: { direction: 'down', gap: 24 } });
    expect(out['s5']?.['layout']).toEqual({ type: 'stack' });
    // a conforming template spec is kept as it was, an item's unknown key too
    expect(out['s3']).toEqual(before['s3']);
    // every other record is unchanged
    for (const id of Object.keys(before).filter((k) => !['g1', 's1', 's2', 's4', 's5'].includes(k))) expect(out[id]).toEqual(before[id]);
  });

  it('FR-LAY-014: a template spec needs an id and items, each checked, an error at its path otherwise', () => {
    const items = [
      { label: 'A', detail: 'first' },
      { label: 'B', children: [{ label: 'B1' }] },
    ];
    expect(parses({ type: 'template', id: 'process.chevron', items })).toBe(true);
    expect(parses({ type: 'template', id: 'acme:flow.wide', items: [] })).toBe(true);
    expect(parses({ type: 'template', id: 'pyramid', items, options: { gap: 8 }, live: true })).toBe(true);
    for (const bad of [
      { type: 'template', items },
      { type: 'template', id: 'pyramid' },
      { type: 'template', id: 'Process', items },
      { type: 'template', id: 'pyramid', items: [{ detail: 'no label' }] },
      { type: 'template', id: 'pyramid', items: [{ label: 'A', children: [{ label: 2 }] }] },
      { type: 'stack', id: 3 },
    ])
      expect(parses(bad), JSON.stringify(bad)).toBe(false);
    expect(codes(withLayout('s3', { type: 'template', id: 'pyramid' }))).toContain('FLX_SCHEMA_INVALID /records/s3/layout/items');
    expect(codes(withLayout('g1', { type: 'template', items }))).toContain('FLX_SCHEMA_INVALID /records/g1/layout/id');
    expect(codes(withLayout('s1', { type: 'template', id: 'pyramid', items: [{ label: 'A', children: [{}] }] }))).toContain(
      'FLX_SCHEMA_INVALID /records/s1/layout/items/0/children/0/label',
    );
  });

  it('FR-LAY-014, NFR-REL-002: items nested past the limit are one error at their path, never a stack overflow', () => {
    const nest = (depth: number) => {
      let item: Fields = { label: 'leaf' };
      for (let i = 1; i < depth; i++) item = { label: `n${i}`, children: [item] };
      return item;
    };
    expect(parses({ type: 'template', id: 'hierarchy.org', items: [nest(MAX_TEMPLATE_DEPTH)] })).toBe(true);
    expect(parses({ type: 'template', id: 'hierarchy.org', items: [nest(MAX_TEMPLATE_DEPTH + 1)] })).toBe(false);
    const hostile = nest(20_000);
    expect(() => validate(withLayout('s3', { type: 'template', id: 'hierarchy.org', items: [hostile] }))).not.toThrow();
    expect(codes(withLayout('s3', { type: 'template', id: 'hierarchy.org', items: [hostile] }))).toContain('FLX_SCHEMA_INVALID /records/s3/layout/items');
    expect(templateItemSchema.safeParse(hostile).success).toBe(false);
    expect(templateItemSchema.safeParse(nest(3)).success).toBe(true);
    // a cyclic value stops at the limit
    const cyclic: { label: string; children: unknown[] } = { label: 'loop', children: [] };
    cyclic.children.push(cyclic);
    expect(templateItemSchema.safeParse(cyclic).success).toBe(false);
  });
});
