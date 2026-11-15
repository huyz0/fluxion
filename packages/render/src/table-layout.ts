// A table's grid and cell styles (FR-SHP-014, ADR-0054): each row's and column's share of the box from its weight, each drawn
// cell's box (a cell with spans covers the cells to its right and below; a key no cell holds or covers is an empty cell), and the
// style a cell resolves: its own style, over the table style's part for its row (the header for the first, the band for every
// second body row), over the part every cell takes and the border part, over the theme's defaults for `table`. A table style the
// theme does not name falls back to the built-in one of that name, so a theme record written before table styles still draws
// `plain`, `banded` and `grid`.
import type { Style, TableElement } from '@fluxion/schema';
import { BUILTIN_TABLE_STYLES, type ResolvedStyle, resolveStyle, type Theme } from '@fluxion/theme';

/**
 * A cell as drawn: where it is in the box, which grid cell it starts at, and what it spans.
 *
 * @public
 */
export type TableCellBox = {
  /** The `"r:c"` key of its first grid cell. */
  readonly key: string;
  /** Its first row. */
  readonly row: number;
  /** Its first column. */
  readonly col: number;
  /** Rows it spans (at least 1). */
  readonly rowSpan: number;
  /** Columns it spans (at least 1). */
  readonly colSpan: number;
  /** Left edge in the box. */
  readonly x: number;
  /** Top edge in the box. */
  readonly y: number;
  /** Width. */
  readonly w: number;
  /** Height. */
  readonly h: number;
};

/** The running sums of `weights` scaled to `total`: edge `i` is where part `i` starts; the last edge is `total`. */
function edges(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = [0];
  let at = 0;
  for (const w of weights) {
    at += w;
    out.push(sum > 0 ? (at / sum) * total : 0);
  }
  return out;
}

/** A span read as a whole number of at least 1 that stays inside `room`. */
const span = (value: number | undefined, room: number) => Math.max(1, Math.min(room, Math.floor(value ?? 1)));

/** Every grid key the cell at `at` with its spans takes, added to `covered`. */
function cover(covered: Set<string>, at: { readonly row: number; readonly col: number; readonly rowSpan: number; readonly colSpan: number }): void {
  for (let r = at.row; r < at.row + at.rowSpan; r++) for (let c = at.col; c < at.col + at.colSpan; c++) covered.add(`${r}:${c}`);
}

/**
 * The cells of `table` drawn in a box `w × h`, row by row: each held cell with its spans, and an empty cell for each grid cell no
 * cell holds or covers.
 *
 * @public
 */
export function tableCells(table: Pick<TableElement, 'rows' | 'cols' | 'cells'>, size: { readonly w: number; readonly h: number }): readonly TableCellBox[] {
  const ys = edges(
    table.rows.map((r) => r.h),
    size.h,
  );
  const xs = edges(
    table.cols.map((c) => c.w),
    size.w,
  );
  const [nr, nc] = [table.rows.length, table.cols.length];
  const covered = new Set<string>();
  const out: TableCellBox[] = [];
  for (let row = 0; row < nr; row++)
    for (let col = 0; col < nc; col++) {
      const key = `${row}:${col}`;
      if (covered.has(key)) continue;
      const cell = table.cells[key];
      const rowSpan = span(cell?.rowSpan, nr - row);
      const colSpan = span(cell?.colSpan, nc - col);
      cover(covered, { row, col, rowSpan, colSpan });
      const [x, y] = [xs[col] as number, ys[row] as number];
      out.push({ key, row, col, rowSpan, colSpan, x, y, w: (xs[col + colSpan] as number) - x, h: (ys[row + rowSpan] as number) - y });
    }
  return out;
}

type Fragment = { readonly [field: string]: unknown };
const isObject = (v: unknown): v is Fragment => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `over` laid on `under`, nested objects merged field by field. */
function merged(under: Fragment, over: Fragment | undefined): Fragment {
  if (over === undefined) return under;
  const out: { [field: string]: unknown } = { ...under };
  for (const [k, v] of Object.entries(over)) out[k] = isObject(v) && isObject(out[k]) ? merged(out[k] as Fragment, v) : v;
  return out;
}

/** The table style part a cell at `row` takes for its row: the header for row 0, the band for every second body row. */
function rowPart(row: number): 'header' | 'band' | undefined {
  if (row === 0) return 'header';
  return row % 2 === 0 ? 'band' : undefined;
}

/**
 * The style of the cell of `table` starting at `row` (its `style` given), resolved against `theme` and its table style.
 *
 * @public
 */
export function tableCellStyle(table: Pick<TableElement, 'id' | 'tableStyle'>, row: number, style: Style | undefined, theme: Theme): ResolvedStyle {
  const name = table.tableStyle;
  const parts = name === undefined ? undefined : (theme.tableStyles?.[name] ?? BUILTIN_TABLE_STYLES[name]);
  const part = rowPart(row);
  const defaults = merged(merged(parts?.border ?? {}, parts?.cell), part === undefined ? undefined : parts?.[part]);
  // tzap disable next-line StringLiteral,ArrayDeclaration: the kind names the theme's defaults; the paths only place diagnostics
  return resolveStyle(style, { kind: 'table', defaults: defaults as Style, defaultsAt: ['theme', 'tableStyles', name ?? ''] }, theme, [
    'records',
    table.id,
    'cells',
  ]).style;
}
