// Expand for tables, frames and masters (ADR-0219): a table node's rows as the table element's `rows`, `cols` and `cells`, and the size an
// unpinned table takes.
import type { RichTextDoc } from '@fluxion/schema';
import type { NodeAst, TableAst, TableCellAst } from '../read/ast.js';
import { columns } from '../read/containers.js';

/** The size of one cell of an unpinned table: the table is this per column and per row. */
export const TABLE_CELL = { w: 160, h: 48 } as const;

/** The default size of a table: TABLE_CELL per column and per row. */
export const tableSize = (t: TableAst): { readonly w: number; readonly h: number } => ({
  w: TABLE_CELL.w * columns(t),
  h: TABLE_CELL.h * (t.heights?.length ?? t.rows.length),
});

/** A slot's keys: a master node's placeholder name, and the record id of the placeholder a node fills. */
export function slotOf(n: NodeAst, id: (slug: string) => string): { readonly [key: string]: unknown } {
  return { ...(n.placeholder ? { placeholder: n.placeholder.value } : {}), ...(n.fills ? { fills: id(n.fills.value) } : {}) };
}

/** A node's content: its table's fields, else its text. */
export function contentOf(n: NodeAst, text: string | undefined, rich: (text: string) => RichTextDoc): { readonly [key: string]: unknown } {
  if (n.table) return tableFields(n.table.value, rich);
  return text === undefined ? {} : { text: rich(text) };
}

/** A table's own fields: row and column weights, cells keyed `r:c` (zero-based), and its table style. */
/** A written cell as a table cell, or undefined for no cell (a `null`, or a cell with nothing in it). */
function cellOf(c: TableCellAst | null, rich: (text: string) => RichTextDoc): { readonly [key: string]: unknown } | undefined {
  if (c === null || Object.keys(c).length === 0) return undefined;
  return {
    ...(c.text === undefined ? {} : { text: rich(c.text) }),
    ...(c.rowSpan ? { rowSpan: c.rowSpan } : {}),
    ...(c.colSpan ? { colSpan: c.colSpan } : {}),
  };
}

export function tableFields(t: TableAst, rich: (text: string) => RichTextDoc): { readonly [key: string]: unknown } {
  const cells: { [key: string]: unknown } = {};
  t.rows.forEach((row, r) => {
    row.forEach((c, k) => {
      const out = cellOf(c, rich);
      if (out) cells[`${r}:${k}`] = out;
    });
  });
  const weights = (given: readonly number[] | undefined, n: number) => given ?? Array.from({ length: n }, () => 1);
  return {
    rows: weights(t.heights, t.rows.length).map((h) => ({ h })),
    cols: weights(t.widths, columns(t)).map((w) => ({ w })),
    cells,
    ...(t.tableStyle === undefined ? {} : { tableStyle: t.tableStyle }),
  };
}
