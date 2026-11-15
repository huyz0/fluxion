// Schema 1.8 (ADR-0054): master screens and placeholders, the `table` element, text regions and icon slots, aspect and selection locks,
// the `path` field (ADR-0053).
import { describe, expect, it } from 'vitest';
import nonconforming from './__fixtures__/migration/nonconforming-1.7.flux.json' with { type: 'json' };
import v17 from './__fixtures__/v1.7/document.flux.json' with { type: 'json' };
import v18 from './__fixtures__/v1.8/document.flux.json' with { type: 'json' };
import { migrate } from './migrate.js';
import { parseDocument, serializeDocument } from './serialize.js';
import { validate } from './validate.js';

type Fields = { readonly [key: string]: unknown };
const records = (doc: { records: object }) => doc.records as { readonly [id: string]: Fields };
const withRecord = (id: string, record: Fields) => ({ ...v18, records: { ...v18.records, [id]: record } });
const patched = (id: string, fields: Fields) => withRecord(id, { ...records(v18)[id], ...fields });
const errors = (doc: unknown) =>
  validate(doc)
    .filter((d) => d.severity === 'error')
    .map((d) => `${d.code} ${d.path}`);
const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const table = (fields: Fields) => ({
  id: 'tbx',
  type: 'element',
  kind: 'table',
  screenId: 's1',
  index: 'a8',
  transform: { x: 0, y: 0, w: 300, h: 100 },
  rows: [{ h: 1 }, { h: 1 }],
  cols: [{ w: 1 }, { w: 1 }],
  cells: {},
  ...fields,
});

describe('schema 1.8 (FR-SCR-005, FR-SHP-014, FR-SHP-007, FR-SHP-008, FR-SHP-010)', () => {
  it('FR-SCR-005: a 1.7 document migrates to a valid 1.8 one with its records unchanged and round-trips', () => {
    const r = migrate(v17);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.applied).toEqual(['1.7→1.8']);
    expect(r.value.document.schemaVersion).toBe('1.8');
    expect(r.value.document.records).toEqual(v17.records);
    expect(validate(r.value.document)).toEqual([]);
    const again = parseDocument(serializeDocument(r.value.document as never));
    expect(again.ok && again.value.document).toEqual(r.value.document);
  });

  it('FR-SCR-005, FR-SHP-014: the 1.8 fixture holds a master with a filled placeholder, a table, regions, icons, locks and a path, validates and round-trips byte for byte', () => {
    expect(validate(v18)).toEqual([]);
    const r = records(v18);
    expect(r['sm1']).toMatchObject({ role: 'master' });
    expect(r['s1']).toMatchObject({ masterId: 'sm1', hideMasterElements: false });
    expect(r['pm1']).toMatchObject({ placeholder: 'title' });
    expect(r['f1']).toMatchObject({ fills: 'pm1' });
    expect(r['tb1']).toMatchObject({ kind: 'table', tableStyle: 'banded' });
    expect(r['e2']).toMatchObject({ texts: { caption: {} }, icons: { badge: { defId: 'basic:star' }, logo: { assetId: 'a1' } }, locks: { aspect: true } });
    expect(r['pm2']).toMatchObject({ locks: { select: true } });
    expect(r['pth1']).toMatchObject({ defId: 'core:path', path: { w: 100, h: 80, fillRule: 'evenodd' } });
    const parsed = parseDocument(JSON.stringify(v18));
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(serializeDocument(parsed.value.document)).toBe(`${JSON.stringify(v18, null, 2)}\n`);
  });

  it('FR-SHP-014: a table needs rows and columns with positive weights and cells inside its grid that do not overlap', () => {
    expect(errors(withRecord('tbx', table({ cells: { '0:0': { colSpan: 2 }, '1:0': {}, '1:1': { text: para('x') } } })))).toEqual([]);
    expect(errors(withRecord('tbx', table({ rows: [] })))).toContain('FLX_SCHEMA_INVALID /records/tbx/rows');
    expect(errors(withRecord('tbx', table({ cols: [{ w: 0 }] })))).toContain('FLX_SCHEMA_INVALID /records/tbx/cols/0/w');
    expect(errors(withRecord('tbx', table({ cells: { '2:0': {} } })))).toContain('FLX_SCHEMA_INVALID /records/tbx/cells/2:0');
    expect(errors(withRecord('tbx', table({ cells: { '0:1': { colSpan: 2 } } })))).toContain('FLX_SCHEMA_INVALID /records/tbx/cells/0:1');
    expect(errors(withRecord('tbx', table({ cells: { a: {} } })))).toContain('FLX_SCHEMA_INVALID /records/tbx/cells/a');
    expect(errors(withRecord('tbx', table({ cells: { '00:1': {} } })))).toContain('FLX_SCHEMA_INVALID /records/tbx/cells/00:1');
    // a cell spanning down covers the cell below it
    expect(
      errors(withRecord('tbx', table({ cells: { '0:0': { rowSpan: 2 }, '1:0': {} } }))).some((e) => e.startsWith('FLX_SCHEMA_INVALID /records/tbx/cells/')),
    ).toBe(true);
    expect(errors(withRecord('tbx', table({ cells: { '0:0': { rowSpan: 0 } } })))).toContain('FLX_SCHEMA_INVALID /records/tbx/cells/0:0/rowSpan');
  });

  it('NFR-REL-002, FR-SHP-014: a table holds at most 500 rows and 500 columns, and checking a hostile grid stays bounded by its area', () => {
    const lines = (n: number, key: 'h' | 'w') => Array.from({ length: n }, () => ({ [key]: 1 }));
    // a 4000 × 4000 span in a 64 KB file is refused on the row and column counts, without walking 16 million slots
    const hostile = table({ rows: lines(4000, 'h'), cols: lines(4000, 'w'), cells: { '0:0': { rowSpan: 4000, colSpan: 4000 } } });
    const refused = errors(withRecord('tbx', hostile));
    expect(refused).toContain('FLX_SCHEMA_INVALID /records/tbx/rows');
    expect(refused).toContain('FLX_SCHEMA_INVALID /records/tbx/cols');
    // the largest table validates; a second full-grid cell overlapping the first is refused once, at its first slot
    const full = { rowSpan: 500, colSpan: 500 };
    expect(errors(withRecord('tbx', table({ rows: lines(500, 'h'), cols: lines(500, 'w'), cells: { '0:0': full } })))).toEqual([]);
    const twice = errors(
      withRecord('tbx', table({ rows: lines(500, 'h'), cols: lines(500, 'w'), cells: { '0:0': full, '0:1': { rowSpan: 500, colSpan: 499 } } })),
    );
    expect(twice).toEqual(['FLX_SCHEMA_INVALID /records/tbx/cells/0:1']);
    // many large cells whose conflict is the last slot each scans: the check stops at the first overlap, so one issue, not one per cell
    const late: Record<string, unknown> = { '499:499': {} };
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) late[`${i}:${j}`] = { rowSpan: 500 - i, colSpan: 500 - j };
    expect(errors(withRecord('tbx', table({ rows: lines(500, 'h'), cols: lines(500, 'w'), cells: late })))).toEqual([
      'FLX_SCHEMA_INVALID /records/tbx/cells/0:0',
    ]);
  });

  it('FR-SHP-014: no image paint in a cell style or a theme table style, so tables add no asset reference', () => {
    const image = { type: 'image', assetId: 'a1' };
    expect(errors(withRecord('tbx', table({ cells: { '0:0': { style: { fill: '#ffffff' } } } })))).toEqual([]);
    expect(errors(withRecord('tbx', table({ cells: { '0:0': { style: { fill: image } } } })))).toContain(
      'FLX_SCHEMA_INVALID /records/tbx/cells/0:0/style/fill',
    );
    expect(errors(patched('th1', { tableStyles: { x: { header: { fill: image } } } }))).toContain('FLX_SCHEMA_INVALID /records/th1/tableStyles/x/header/fill');
    expect(errors(patched('th1', { tableStyles: { x: { band: { fill: '#eeeeee' } } } }))).toEqual([]);
  });

  it('FR-SHP-014: a table is a leaf, so no element can name it as its parent', () => {
    const child = {
      id: 'ch',
      type: 'element',
      kind: 'shape',
      screenId: 's1',
      parentId: 'tb1',
      index: 'a0',
      defId: 'basic:rect',
      transform: { x: 0, y: 0, w: 1, h: 1 },
    };
    expect(errors(withRecord('ch', child))).toContain('FLX_PARENT_INVALID /records/ch/parentId');
  });

  it('FR-SCR-005: fills names an element and an icon asset names an asset; master rules are not validation errors', () => {
    expect(errors(patched('f1', { fills: 'gone' }))).toContain('FLX_REF_MISSING /records/f1/fills');
    expect(errors(patched('f1', { fills: 's1' }))).toContain('FLX_REF_WRONG_TYPE /records/f1/fills');
    expect(errors(patched('e2', { icons: { logo: { assetId: 'gone' } } }))).toContain('FLX_REF_MISSING /records/e2/icons/logo/assetId');
    expect(errors(patched('e2', { icons: { logo: { assetId: 'e1' } } }))).toContain('FLX_REF_WRONG_TYPE /records/e2/icons/logo/assetId');
    // a master that does not apply (not a master, a chain, another size, an infinite screen) and a fill naming no placeholder still validate
    expect(errors(patched('s3', { masterId: 's1' }))).toEqual([]);
    expect(errors(patched('sm1', { masterId: 's3' }))).toEqual([]);
    expect(errors(patched('sm1', { size: { w: 800, h: 600 } }))).toEqual([]);
    expect(errors(patched('s2', { masterId: 'sm1' }))).toEqual([]);
    expect(errors(patched('f1', { fills: 'e1' }))).toEqual([]);
  });

  it('FR-SHP-007, FR-SHP-008, FR-SHP-010: each new field is typed, an error at its path otherwise', () => {
    expect(errors(patched('sm1', { role: 'slide' }))).toContain('FLX_SCHEMA_INVALID /records/sm1/role');
    expect(errors(patched('s1', { hideMasterElements: 1 }))).toContain('FLX_SCHEMA_INVALID /records/s1/hideMasterElements');
    expect(errors(patched('pm1', { placeholder: '' }))).toContain('FLX_SCHEMA_INVALID /records/pm1/placeholder');
    expect(errors(patched('e2', { locks: { aspect: 'yes' } }))).toContain('FLX_SCHEMA_INVALID /records/e2/locks/aspect');
    expect(errors(patched('pm2', { locks: { select: 0 } }))).toContain('FLX_SCHEMA_INVALID /records/pm2/locks/select');
    expect(errors(patched('e2', { texts: { caption: 'plain' } }))).toContain('FLX_SCHEMA_INVALID /records/e2/texts/caption');
    expect(errors(patched('e2', { icons: { both: { defId: 'basic:star', assetId: 'a1' } } }))).toContain('FLX_SCHEMA_INVALID /records/e2/icons/both');
    expect(errors(patched('pth1', { path: { d: 'M0 0', w: 0, h: 1 } }))).toContain('FLX_SCHEMA_INVALID /records/pth1/path/w');
    expect(errors(patched('pth1', { path: { d: 'M0 0', w: 1, h: 1, fillRule: 'odd' } }))).toContain('FLX_SCHEMA_INVALID /records/pth1/path/fillRule');
  });

  it('FR-SCR-005, FR-SHP-014: the 1.7 → 1.8 step removes what does not conform, renames tables that cannot be 1.8 tables and leaves masterId alone', () => {
    expect(errors({ ...nonconforming, schemaVersion: '1.8' }).length).toBeGreaterThan(0);
    const r = migrate(nonconforming);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.applied).toEqual(['1.7→1.8']);
    // valid; the renamed tables are unknown kinds, each a warning that it is kept and shown as a placeholder
    expect(errors(r.value.document)).toEqual([]);
    expect(validate(r.value.document).map((d) => `${d.code} ${d.path}`)).toEqual(['tbB', 'tbC', 'tbD'].map((id) => `FLX_KIND_UNKNOWN /records/${id}/kind`));
    const out = records(r.value.document);
    const before = records(nonconforming);
    // screens: a role that is not 'master' and a non-boolean hideMasterElements go; every masterId stays, a loose conforming role too
    expect(out['s1']).toEqual({ ...Object.fromEntries(Object.entries(before['s1'] ?? {}).filter(([k]) => k !== 'role' && k !== 'hideMasterElements')) });
    expect(out['s1']?.['masterId']).toBe('s2');
    expect(out['s3']).toEqual(before['s3']);
    expect(out['s2']?.['masterId']).toBe('s3');
    // a non-conforming placeholder, a dangling fills, a fills naming a screen and a non-boolean lock go; a boolean lock stays
    expect(out['e1']).not.toHaveProperty('placeholder');
    expect(out['e1']).not.toHaveProperty('fills');
    expect(out['e1']?.['locks']).toEqual({ select: true });
    expect(out['tx1']).not.toHaveProperty('fills');
    // a region text that is not rich text, an icon that is neither form and an icon naming no asset go; a bad path goes
    expect(out['e2']?.['texts']).toEqual({ caption: (before['e2']?.['texts'] as Fields | undefined)?.['caption'] });
    expect(out['e2']?.['icons']).toEqual({ a: { defId: 'basic:star' } });
    expect(out['e2']).not.toHaveProperty('path');
    // tables: a bad tableStyle goes and the table stays; no transform, a child, or an image-filled cell make it legacy-table
    expect(out['tbA']).toMatchObject({ kind: 'table' });
    expect(out['tbA']).not.toHaveProperty('tableStyle');
    for (const id of ['tbB', 'tbC', 'tbD']) expect(out[id]).toEqual({ ...before[id], kind: 'legacy-table' });
    expect(out['ch1']).toEqual(before['ch1']);
    // theme: a table style holding an image paint goes, the others stay
    expect(out['th1']?.['tableStyles']).toEqual({ good: { header: { fill: '#ffffff' } } });
    // every other record is unchanged
    const touched = ['s1', 'e1', 'tx1', 'e2', 'tbA', 'tbB', 'tbC', 'tbD', 'th1'];
    for (const id of Object.keys(before).filter((k) => !touched.includes(k))) expect(out[id], id).toEqual(before[id]);
    // migrating the result again changes nothing
    const twice = migrate({ ...r.value.document, schemaVersion: '1.7' });
    expect(twice.ok && twice.value.document.records).toEqual(r.value.document.records);
  });
});
