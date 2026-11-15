// Table editing in the editor (FR-SHP-014, ADR-0054): a click on a selected table picks the cell under it (shift-click extends
// the range); the table commands insert and delete rows and columns beside the picked cells, merge the range and split a merged
// cell; Tab and Shift+Tab move the picked cell in reading order; a drag on a border between two rows or columns resizes them. Each
// operation is one `element.update` of the table's grid (one undo step), refused on a table locked against editing. The grid
// maths is core's (table-ops.ts); the cell boxes are render's (`tableCells`).
import {
  type CellArea,
  coveringArea,
  insertLine,
  lockedWithin,
  mergeCells,
  type ReadView,
  removeLine,
  splitCell,
  stepCell,
  type TableAxis,
  type TableGrid,
} from '@fluxion/core';
import { apply, elementMatrix, invert, type Vec2 } from '@fluxion/geometry';
import { tableCells } from '@fluxion/render';
import type { RecordId, TableElement } from '@fluxion/schema';
import { createElement } from './create-tool.js';
import type { TableCellRange } from './session.js';
import type { ToolCtx } from './tools.js';

/**
 * The table `id`; undefined for anything else.
 *
 * @public
 */
export function tableOf(view: ReadView, id: RecordId): TableElement | undefined {
  const record = view.get(id) as TableElement | undefined;
  return record?.type === 'element' && record.kind === 'table' ? record : undefined;
}

/** Page point `p` in the table's own box; undefined when its placement cannot be inverted. */
function toBox(table: TableElement, p: Vec2): Vec2 | undefined {
  const back = invert(elementMatrix({ ...table.transform, rot: table.transform.rot ?? 0 }));
  return back.ok ? apply(back.value, p) : undefined;
}

/**
 * The cell of `table` under page point `p` (the first grid cell of a merged one); undefined off the table.
 *
 * @public
 */
export function cellAt(table: TableElement, p: Vec2): { readonly row: number; readonly col: number } | undefined {
  const at = toBox(table, p);
  if (at === undefined) return undefined;
  const { w, h } = table.transform;
  const hit = tableCells(table, { w, h }).find((c) => at.x >= c.x && at.x <= c.x + c.w && at.y >= c.y && at.y <= c.y + c.h);
  return hit === undefined ? undefined : { row: hit.row, col: hit.col };
}

/**
 * A press at page point `p` on the table `id`, already the one selected: pick the cell there, or with `extend` stretch the range
 * from the cell first picked. False off the table's cells.
 *
 * @public
 */
export function pickCell(ctx: ToolCtx, id: RecordId, p: Vec2, extend: boolean): boolean {
  const table = tableOf(ctx.view, id);
  const cell = table === undefined ? undefined : cellAt(table, p);
  if (cell === undefined) return false;
  const now = ctx.session.tableCells.get();
  const from = extend && now?.id === id ? now : { row: cell.row, col: cell.col };
  ctx.session.tableCells.set({ id, row: from.row, col: from.col, toRow: cell.row, toCol: cell.col });
  return true;
}

/**
 * A right-click at page point `p` on the table `id`, already the one selected: the cell there is picked unless the picked range
 * holds it already, so the table menu acts on what was clicked. False when `id` is no table.
 *
 * @public
 */
export function pickForMenu(ctx: ToolCtx, id: RecordId, p: Vec2): boolean {
  const table = tableOf(ctx.view, id);
  const cell = table === undefined ? undefined : cellAt(table, p);
  if (table === undefined) return false;
  const now = ctx.session.tableCells.get();
  const area = now?.id === id ? coveringArea(table, now) : undefined;
  const held = cell !== undefined && area !== undefined && cell.row >= area.row && cell.row <= area.toRow && cell.col >= area.col && cell.col <= area.toCol;
  if (cell !== undefined && !held) pickCell(ctx, id, p, false);
  return true;
}

/**
 * `range` held inside `table`'s grid as it is now: an undo that took lines away leaves no pick past the last.
 *
 * @public
 */
export function fitRange(table: TableElement, range: TableCellRange): TableCellRange {
  const clampTo = (n: number, lines: number) => Math.max(0, Math.min(n, lines - 1));
  const [rows, cols] = [table.rows.length, table.cols.length];
  return { id: range.id, row: clampTo(range.row, rows), col: clampTo(range.col, cols), toRow: clampTo(range.toRow, rows), toCol: clampTo(range.toCol, cols) };
}

/** The picked cells and their table, when the table is the whole selection. */
function picked(ctx: ToolCtx): { readonly table: TableElement; readonly range: TableCellRange; readonly area: CellArea } | undefined {
  const now = ctx.session.tableCells.get();
  const [only, ...rest] = ctx.session.selection.get();
  if (now === undefined || only !== now.id || rest.length > 0) return undefined;
  const table = tableOf(ctx.view, only);
  const range = table === undefined ? undefined : fitRange(table, now);
  return table === undefined || range === undefined ? undefined : { table, range, area: coveringArea(table, range) };
}

/** Write `grid` to `table` (one undo step) and pick `next`; false when the table is locked against editing or `grid` is none. */
function commit(ctx: ToolCtx, table: TableElement, grid: TableGrid | undefined, next: CellArea): boolean {
  if (grid === undefined || lockedWithin(ctx.view, table.id, 'edit')) return false;
  const r = ctx.execute('element.update', { id: table.id, fields: { rows: grid.rows, cols: grid.cols, cells: grid.cells } });
  ctx.seal();
  if (!r.ok) return false;
  ctx.session.tableCells.set(fitRange({ ...table, ...grid }, { id: table.id, ...next }));
  return true;
}

/** Each axis's first and last line of an area, and how an area moves along it. */
const SIDE = {
  row: { first: (a: CellArea) => a.row, last: (a: CellArea) => a.toRow, shift: (a: CellArea, d: number) => ({ ...a, row: a.row + d, toRow: a.toRow + d }) },
  col: { first: (a: CellArea) => a.col, last: (a: CellArea) => a.toCol, shift: (a: CellArea, d: number) => ({ ...a, col: a.col + d, toCol: a.toCol + d }) },
} as const;

/**
 * Insert a row (or column) before the picked cells (`after` false) or after them; the picked cells stay where they are.
 *
 * @public
 */
export function insertBeside(ctx: ToolCtx, axis: TableAxis, after: boolean): boolean {
  const on = picked(ctx);
  if (on === undefined) return false;
  const side = SIDE[axis];
  const index = after ? side.last(on.area) + 1 : side.first(on.area);
  return commit(ctx, on.table, insertLine(on.table, axis, index), after ? on.area : side.shift(on.area, 1));
}

/**
 * Delete the rows (or columns) the picked cells are on; false when that would leave none.
 *
 * @public
 */
export function deleteLines(ctx: ToolCtx, axis: TableAxis): boolean {
  const on = picked(ctx);
  if (on === undefined) return false;
  const side = SIDE[axis];
  let grid: TableGrid | undefined = on.table;
  // from the last, so each index is still the line it named
  for (let i = side.last(on.area); i >= side.first(on.area) && grid !== undefined; i--) grid = removeLine(grid, axis, i);
  const at = side.first(on.area);
  const one = axis === 'row' ? { row: at, toRow: at, col: on.area.col, toCol: on.area.col } : { col: at, toCol: at, row: on.area.row, toRow: on.area.row };
  return commit(ctx, on.table, grid, one);
}

/**
 * Merge the picked cells (with every merged cell the range touches) into one.
 *
 * @public
 */
export function mergePicked(ctx: ToolCtx): boolean {
  const on = picked(ctx);
  return on !== undefined && commit(ctx, on.table, mergeCells(on.table, on.area), { ...on.area, toRow: on.area.row, toCol: on.area.col });
}

/**
 * Split the merged cell the picked range starts at back into its grid cells.
 *
 * @public
 */
export function splitPicked(ctx: ToolCtx): boolean {
  const on = picked(ctx);
  return on !== undefined && commit(ctx, on.table, splitCell(on.table, on.area.row, on.area.col), { ...on.area, toRow: on.area.row, toCol: on.area.col });
}

/**
 * Move the picked cell to the next (`step` 1) or previous cell in reading order: Tab and Shift+Tab. False with no cell picked
 * or past the first or last cell.
 *
 * @public
 */
export function stepPicked(ctx: ToolCtx, step: 1 | -1): boolean {
  const on = picked(ctx);
  const to = on === undefined ? undefined : stepCell(on.table, on.range.toRow, on.range.toCol, step);
  if (on === undefined || to === undefined) return false;
  ctx.session.tableCells.set({ id: on.table.id, row: to.row, col: to.col, toRow: to.row, toCol: to.col });
  return true;
}

/** The size a new table takes, page units. */
const NEW_TABLE = { w: 360, h: 120, rows: 3, cols: 3 } as const;

/**
 * Add a 3 × 3 table in the `grid` style at the middle of the canvas's screen, selected with its first cell picked; one undo step.
 *
 * @public
 */
export function insertTable(ctx: ToolCtx): boolean {
  const screen = ctx.screen === undefined ? undefined : (ctx.view.get(ctx.screen) as { size?: { w?: number; h?: number } } | undefined);
  const [sw, sh] = [screen?.size?.w ?? 960, screen?.size?.h ?? 540];
  const box = { x: Math.round((sw - NEW_TABLE.w) / 2), y: Math.round((sh - NEW_TABLE.h) / 2), w: NEW_TABLE.w, h: NEW_TABLE.h };
  const id = createElement(ctx, box, (base) => ({
    ...base,
    type: 'element',
    kind: 'table',
    rows: Array.from({ length: NEW_TABLE.rows }, () => ({ h: 1 })),
    cols: Array.from({ length: NEW_TABLE.cols }, () => ({ w: 1 })),
    cells: {},
    tableStyle: 'grid',
  }));
  if (id === undefined) return false;
  ctx.session.tableCells.set({ id, row: 0, col: 0, toRow: 0, toCol: 0 });
  return true;
}
