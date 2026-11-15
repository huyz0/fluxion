// FluxScript keys for masters, placeholders, tables and frames (ADR-0219): read, resolve, expand, place and decompile.
import { idKeys, sha256Hash128, stableId } from '@fluxion/core';
import { type DocumentFile, type RecordId, serializeDocument } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { decompile } from '../decompile/decompile.js';
import { registries } from '../decompile/registries.fixture.js';
import type { CompileResult } from '../types.js';

const run = (text: string): CompileResult => compile(text, { registries: registries() });
const doc = (body: string) => `flux: 1\ntitle: Plan\nuses: [basic]\nscreens:\n${body}`;
const id = (key: string) => stableId(sha256Hash128, '', key) as RecordId;
const rec = (r: CompileResult, key: string) => r.doc?.records[id(key)] as unknown as { readonly [k: string]: unknown } | undefined;
const codes = (r: CompileResult) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.path}`);

const MASTERED = doc(`  - id: deck
    role: master
    nodes:
      slot: { shape: rect, placeholder: title, pin: { x: 100, y: 100, w: 400, h: 80 } }
  - id: plan
    master: deck
    nodes:
      heading: { text: Plan, fills: slot, pin: { x: 100, y: 100, w: 400, h: 80 } }
`);

const TABLE = doc(`  - id: plan
    nodes:
      t:
        table:
          rows: [[Stream, Weeks], [{ text: Both, colSpan: 2 }, null], [Ada, 6]]
          widths: [3, 1]
          tableStyle: banded
`);

const FRAMED = doc(`  - id: plan
    layout: { type: stack, direction: down }
    nodes:
      a: { shape: rect, label: A }
      b: { shape: rect, label: B }
      wide: { shape: rect, label: Wide, pin: { x: 900, y: 500, w: 400, h: 100 } }
    groups:
      box: { label: Box, frame: true, clip: false, contains: [a, b, wide], pin: { x: 600, y: 300, w: 500, h: 400 } }
`);

describe('masters and placeholders in FluxScript (ADR-0219)', () => {
  it('FR-SCR-005: role and master compile to the screen fields, placeholder and fills to the element fields', () => {
    const r = run(MASTERED);
    expect(codes(r)).toEqual([]);
    expect(rec(r, idKeys.screen('deck'))?.['role']).toBe('master');
    expect(rec(r, idKeys.screen('plan'))?.['masterId']).toBe(id(idKeys.screen('deck')));
    expect(rec(r, idKeys.node('slot'))?.['placeholder']).toBe('title');
    expect(rec(r, idKeys.node('heading'))?.['fills']).toBe(id(idKeys.node('slot')));
  });

  it('FR-SCR-005: a master that is not a master screen, a fills that names no placeholder of it, and a bad role are errors at their keys', () => {
    const r = run(
      doc(`  - id: deck
    role: slide
    nodes:
      slot: { shape: rect }
  - id: plan
    master: deck
    nodes:
      heading: { text: Plan, fills: slot }
`),
    );
    expect(codes(r)).toEqual(['FLX_SCHEMA_INVALID /screens/0/role', 'FLX_REF_MISSING /screens/1/master', 'FLX_REF_MISSING /screens/1/nodes/heading/fills']);
  });
});

describe('tables in FluxScript (ADR-0219)', () => {
  it('FR-SHP-014: rows of cells compile to a table element: weights, cells keyed r:c, spans, no cell where null, and a size per cell', () => {
    const r = run(TABLE);
    expect(codes(r)).toEqual([]);
    const t = rec(r, idKeys.node('t'));
    expect(t?.['kind']).toBe('table');
    expect(t?.['rows']).toEqual([{ h: 1 }, { h: 1 }, { h: 1 }]);
    expect(t?.['cols']).toEqual([{ w: 3 }, { w: 1 }]);
    expect(Object.keys(t?.['cells'] as object).sort()).toEqual(['0:0', '0:1', '1:0', '2:0', '2:1']);
    const cells = (t?.['cells'] ?? {}) as { [k: string]: { colSpan?: number } };
    expect(cells['1:0']?.colSpan).toBe(2);
    expect(t?.['tableStyle']).toBe('banded');
    expect(t?.['transform']).toMatchObject({ w: 320, h: 144 });
  });

  it('FR-SHP-014: a table beside a shape, rows that are not lists, a zero weight and a heights list of the wrong length are errors', () => {
    const bad = (table: string, extra = '') => codes(run(doc(`  - id: plan\n    nodes:\n      t: { ${extra}table: ${table} }\n`)));
    expect(bad('{ rows: [[A]] }', 'shape: rect, ')).toEqual(['FLX_SCHEMA_INVALID /screens/0/nodes/t/table']);
    expect(bad('{ rows: [A, B] }')).toEqual(['FLX_SCHEMA_INVALID /screens/0/nodes/t/table/rows']);
    expect(bad('{ rows: [[A]], widths: [0] }')).toEqual(['FLX_SCHEMA_INVALID /screens/0/nodes/t/table/widths']);
    expect(bad('{ rows: [[A]], heights: [1, 1] }')).toEqual(['FLX_SCHEMA_INVALID /screens/0/nodes/t/table/heights']);
    expect(bad('{ rows: [[{ text: A, colSpan: 0 }]] }')).toEqual(['FLX_SCHEMA_INVALID /screens/0/nodes/t/table/rows/0/0/colSpan']);
  });

  it('FR-SHP-014: overlapping spans pass the reader and are refused by schema validation', () => {
    const r = run(doc('  - id: plan\n    nodes:\n      t: { table: { rows: [[{ text: A, colSpan: 2 }, B]] } }\n'));
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});

describe('frames in FluxScript (ADR-0219)', () => {
  it('FR-ARR-006: frame: true compiles to a pinned frame with its clip; its loose members are laid out inside its box, its pin stays', () => {
    const r = run(FRAMED);
    expect(codes(r)).toEqual([]);
    const f = rec(r, idKeys.node('box'));
    expect([f?.['kind'], f?.['clip'], f?.['placement']]).toEqual(['frame', false, 'pinned']);
    expect(f?.['transform']).toMatchObject({ x: 600, y: 300, w: 500, h: 400 });
    for (const slug of ['a', 'b']) {
      const t = rec(r, idKeys.node(slug))?.['transform'] as { x: number; y: number; w: number; h: number };
      expect([t.x >= 600, t.y >= 300, t.x + t.w <= 1100, t.y + t.h <= 700], slug).toEqual([true, true, true, true]);
      expect(rec(r, idKeys.node(slug))?.['parentId']).toBe(id(idKeys.node('box')));
    }
    expect(rec(r, idKeys.node('wide'))?.['transform']).toMatchObject({ x: 900, y: 500 });
  });

  it('FR-ARR-006: frame: false is a plain group, sized by its members', () => {
    const r = run(doc('  - id: plan\n    nodes:\n      a: { shape: rect }\n    groups:\n      g: { label: G, frame: false, contains: [a] }\n'));
    expect(codes(r)).toEqual([]);
    const g = rec(r, idKeys.node('g'));
    expect([g?.['kind'], g?.['placement']]).toEqual(['group', 'auto']);
    const box = (g?.['transform'] ?? { w: 0 }) as { w: number };
    expect(box.w).toBeGreaterThan(0);
  });

  it('FR-ARR-006: a frame without a sized pin, and pin or clip on a group that is not a frame, are errors at their keys', () => {
    const bad = (group: string) => codes(run(doc(`  - id: plan\n    nodes:\n      a: { shape: rect }\n    groups:\n      g: { contains: [a], ${group} }\n`)));
    expect(bad('frame: true, pin: { x: 0, y: 0 }')).toEqual(['FLX_SCHEMA_INVALID /screens/0/groups/g/pin']);
    expect(bad('clip: true')).toEqual(['FLX_SCHEMA_INVALID /screens/0/groups/g/clip']);
    expect(bad('pin: { x: 0, y: 0, w: 10, h: 10 }')).toEqual(['FLX_SCHEMA_INVALID /screens/0/groups/g/pin']);
  });
});

describe('decompiling masters, tables and frames (ADR-0219, FR-DSL-002)', () => {
  it.each([
    ['a master', MASTERED],
    ['a table', TABLE],
    ['a frame', FRAMED],
  ])('FR-DSL-002: %s survives compile(decompile(compile(src))) byte for byte, with nothing left out', (_name, text) => {
    const first = run(text).doc as DocumentFile;
    const back = decompile(first, { registries: registries() });
    expect(back.text).not.toContain('# kept');
    expect(serializeDocument(run(back.text).doc as DocumentFile), back.text).toBe(serializeDocument(first));
  });

  it('FR-DSL-002: a table cell with a style is outside the v0 subset: the table is left out and counted', () => {
    const first = run(TABLE).doc as DocumentFile;
    const t = first.records[id(idKeys.node('t'))] as unknown as { cells: { [k: string]: object } };
    const styled = { ...t, cells: { ...t.cells, '0:0': { ...t.cells['0:0'], style: { fill: '#ff0000' } } } };
    const back = decompile({ ...first, records: { ...first.records, [id(idKeys.node('t'))]: styled as never } }, { registries: registries() });
    expect(back.text).not.toContain('table:');
    expect(back.text).toContain('# kept: 1 records not shown');
  });

  it('FR-DSL-002: a frame with padding or a turn is outside the v0 subset: it is left out and counted, its members with it', () => {
    const first = run(FRAMED).doc as DocumentFile;
    const key = id(idKeys.node('box'));
    const f = first.records[key] as unknown as { transform: object };
    for (const changed of [
      { ...f, padding: 8 },
      { ...f, transform: { ...f.transform, rot: 15 } },
    ]) {
      const back = decompile({ ...first, records: { ...first.records, [key]: changed as never } }, { registries: registries() });
      expect(back.text).not.toContain('frame: true');
      expect(back.text).toContain('# kept: 4 records not shown');
    }
  });
});
