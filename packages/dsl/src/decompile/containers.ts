// The decompiler's v0 support for tables, frames, placeholders and masters (ADR-0219): a table element as `table: { rows, widths, heights,
// tableStyle }`, a frame's own keys, a node's `placeholder` and `fills`, and a screen's `role` and `master`. What the grammar cannot say (a
// cell with a style, a cell key outside the grid) throws Inexpressible, so the element is left out and counted.
import type { RecordId } from '@fluxion/schema';
import type { TableAst, TableCellAst } from '../read/ast.js';
import type { Ctx, El, Rec } from './context.js';
import type { Out } from './emit.js';
import { fail, plainText } from './values.js';

type Entry = readonly [string, Out];
type Obj = { readonly [key: string]: unknown };

const CELL_KEYS = new Set(['text', 'rowSpan', 'colSpan']);

/** Weights as written: undefined when every one is 1. */
function weightsOf(list: unknown, key: 'h' | 'w'): number[] | undefined {
  if (!Array.isArray(list) || list.length === 0) fail('table');
  const out = list.map((x) => (x as Obj)[key]);
  if (!out.every((v) => typeof v === 'number' && v > 0 && Number.isFinite(v))) fail('table');
  return out.every((v) => v === 1) ? undefined : (out as number[]);
}

function cellOf(c: Obj): TableCellAst {
  if (Object.keys(c).some((k) => !CELL_KEYS.has(k))) fail('table cell');
  const text = plainText(c['text'] as never);
  const span = (k: 'rowSpan' | 'colSpan') => (typeof c[k] === 'number' && c[k] !== 1 ? { [k]: c[k] as number } : {});
  return { ...(text === undefined ? {} : { text }), ...span('rowSpan'), ...span('colSpan') };
}

/** A table element as the table it was written from. */
export function tableOf(el: El): TableAst {
  const rows = el['rows'] as readonly unknown[];
  const cols = el['cols'] as readonly unknown[];
  const heights = weightsOf(rows, 'h');
  const widths = weightsOf(cols, 'w');
  const grid: (TableCellAst | null)[][] = rows.map(() => cols.map(() => null));
  for (const [key, c] of Object.entries((el['cells'] ?? {}) as Obj)) {
    const [r, k] = key.split(':').map(Number);
    const row = r === undefined ? undefined : grid[r];
    if (row === undefined || k === undefined || !(k in row) || `${r}:${k}` !== key) fail('table cell');
    row[k] = cellOf(c as Obj);
  }
  const style = el['tableStyle'];
  return {
    rows: grid,
    ...(widths ? { widths } : {}),
    ...(heights ? { heights } : {}),
    ...(typeof style === 'string' ? { tableStyle: style } : {}),
  };
}

const cellOut = (c: TableCellAst | null): Out => {
  if (c === null) return null;
  const keys = Object.keys(c);
  if (keys.length === 1 && c.text !== undefined) return c.text;
  return { map: Object.entries(c) as Entry[], flow: true };
};

/** A table as its `table:` value: every row its full width, `null` where no cell is. */
export function tableOut(t: TableAst): Out {
  return {
    map: [
      ['rows', { seq: t.rows.map((r) => ({ seq: r.map(cellOut), flow: true })) }],
      ...(t.widths ? ([['widths', { seq: t.widths, flow: true }]] as const) : []),
      ...(t.heights ? ([['heights', { seq: t.heights, flow: true }]] as const) : []),
      ...(t.tableStyle !== undefined ? ([['tableStyle', t.tableStyle]] as const) : []),
    ],
  };
}

/** A node's `placeholder` and `fills` (the slug of the node it fills). */
export function slotFields(ctx: Ctx, el: El): Entry[] {
  const name = el['placeholder'];
  const fills = el['fills'];
  if (name !== undefined && typeof name !== 'string') fail('placeholder');
  const target = fills === undefined ? undefined : (ctx.slugs.get(fills as RecordId) ?? fail('fills'));
  return [...(name !== undefined ? ([['placeholder', name]] as const) : []), ...(target !== undefined ? ([['fills', target]] as const) : [])];
}

/** A frame's own keys: `frame: true`, its box as `pin`, its clip when it has one. */
export function frameFields(el: El): Entry[] {
  const t = el['transform'] as Obj | undefined;
  const [x, y, w, h] = ['x', 'y', 'w', 'h'].map((k) => t?.[k]);
  if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) fail('frame');
  // a pin says neither a turn, a flip nor the frame's padding
  if (el['padding'] !== undefined || ['rot', 'flipX', 'flipY'].some((k) => t?.[k] !== undefined && t[k] !== 0 && t[k] !== false)) fail('frame');
  const clip = el['clip'];
  const pin: Out = {
    map: [
      ['x', x as number],
      ['y', y as number],
      ['w', w as number],
      ['h', h as number],
    ],
    flow: true,
  };
  return [['frame', true], ['pin', pin], ...(typeof clip === 'boolean' ? ([['clip', clip]] as const) : [])];
}

/** A screen's `role` and `master`. */
export function screenRoleFields(ctx: Ctx, s: Rec): Entry[] {
  const master = s['masterId'] === undefined ? undefined : ctx.screenIds.get(s['masterId'] as RecordId);
  return [...(s['role'] === 'master' ? ([['role', 'master']] as const) : []), ...(master !== undefined ? ([['master', master]] as const) : [])];
}
