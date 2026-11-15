// Table editing (FR-SHP-014, ADR-0054): the operations the editor applies to a table's grid, each giving the table's new `rows`,
// `cols` and `cells` (one `element.update`, so one undo step) or a refusal. Rows and columns are "lines" of an axis: inserting a
// line shifts the cells after it and widens a merged cell it falls inside; removing one shifts them back and narrows a merged cell
// across it (a merged cell starting on the removed line moves to the next one, keeping its text). Merging takes a rectangle whose
// cells lie wholly inside it; splitting gives a merged cell back its grid cells, empty but the first. Pure.
import type { RichTextDoc, TableCell, TableElement } from '@fluxion/schema';

/**
 * A table's grid: what the operations read and give.
 *
 * @public
 */
export type TableGrid = Pick<TableElement, 'rows' | 'cols' | 'cells'>;

/**
 * Rows or columns.
 *
 * @public
 */
export type TableAxis = 'row' | 'col';

/**
 * A rectangle of grid cells, first and last row and column included.
 *
 * @public
 */
export type CellArea = {
  /** Its first row. */
  readonly row: number;
  /** Its first column. */
  readonly col: number;
  /** Its last row. */
  readonly toRow: number;
  /** Its last column. */
  readonly toCol: number;
};

/** The most rows or columns a table holds (ADR-0054). */
const MAX_LINES = 500;

type Cells = { [key: string]: TableCell };
type Placed = { readonly row: number; readonly col: number; readonly cell: TableCell };

/** The cells of `grid` with their places. */
const placed = (grid: TableGrid): Placed[] =>
  Object.entries(grid.cells).map(([key, cell]) => {
    const [row, col] = key.split(':').map(Number) as [number, number];
    return { row, col, cell };
  });

/** Each axis's start, span field and line list. */
const AXES = {
  row: { start: (p: Placed) => p.row, span: 'rowSpan', lines: 'rows' },
  col: { start: (p: Placed) => p.col, span: 'colSpan', lines: 'cols' },
} as const;

const spanOf = (cell: TableCell, axis: TableAxis) => cell[AXES[axis].span] ?? 1;

/** `cell` with its span along `axis` set to `n` (the field left out at 1). */
function withSpan(cell: TableCell, axis: TableAxis, n: number): TableCell {
  const { [AXES[axis].span]: _old, ...rest } = cell;
  return n > 1 ? { ...rest, [AXES[axis].span]: n } : rest;
}

/** The cells keyed again from their places. */
const keyed = (list: readonly Placed[]): Cells => Object.fromEntries(list.map((p) => [`${p.row}:${p.col}`, p.cell]));

/** `p` moved to `start` along `axis`. */
const at = (p: Placed, axis: TableAxis, start: number, cell: TableCell = p.cell): Placed =>
  axis === 'row' ? { row: start, col: p.col, cell } : { row: p.row, col: start, cell };

/**
 * `grid` with a line inserted along `axis` before line `index` (0 to the count; the count appends), as heavy as the line it is
 * inserted beside; undefined past the limit of 500 or out of range.
 *
 * @public
 */
export function insertLine(grid: TableGrid, axis: TableAxis, index: number): TableGrid | undefined {
  const lines = grid[AXES[axis].lines] as readonly { readonly [k: string]: number }[];
  if (index < 0 || index > lines.length || lines.length >= MAX_LINES) return undefined;
  const beside = lines[Math.min(index, lines.length - 1)] as { readonly [k: string]: number };
  const next = [...lines.slice(0, index), { ...beside }, ...lines.slice(index)];
  const cells = placed(grid).map((p) => {
    const start = AXES[axis].start(p);
    if (start >= index) return at(p, axis, start + 1);
    // a merged cell the new line falls inside widens over it
    return start + spanOf(p.cell, axis) > index ? at(p, axis, start, withSpan(p.cell, axis, spanOf(p.cell, axis) + 1)) : p;
  });
  return { ...grid, [AXES[axis].lines]: next, cells: keyed(cells) } as TableGrid;
}

/**
 * `grid` without line `index` along `axis`; undefined for the last line left or out of range.
 *
 * @public
 */
export function removeLine(grid: TableGrid, axis: TableAxis, index: number): TableGrid | undefined {
  const lines = grid[AXES[axis].lines] as readonly unknown[];
  if (index < 0 || index >= lines.length || lines.length <= 1) return undefined;
  const cells = placed(grid).flatMap((p): Placed[] => {
    const start = AXES[axis].start(p);
    const span = spanOf(p.cell, axis);
    if (start > index) return [at(p, axis, start - 1)];
    if (start + span <= index) return [p];
    // the cell is on the removed line: gone when it is one line thick, else one line thinner (from the same start)
    return span === 1 ? [] : [at(p, axis, start, withSpan(p.cell, axis, span - 1))];
  });
  return { ...grid, [AXES[axis].lines]: lines.filter((_, i) => i !== index), cells: keyed(cells) } as TableGrid;
}

/** The area a placed cell covers. */
const areaOf = (p: Placed): CellArea => ({ row: p.row, col: p.col, toRow: p.row + spanOf(p.cell, 'row') - 1, toCol: p.col + spanOf(p.cell, 'col') - 1 });

const overlaps = (a: CellArea, b: CellArea) => a.row <= b.toRow && b.row <= a.toRow && a.col <= b.toCol && b.col <= a.toCol;
const inside = (a: CellArea, b: CellArea) => a.row >= b.row && a.toRow <= b.toRow && a.col >= b.col && a.toCol <= b.toCol;

/**
 * The smallest rectangle holding `area` and every merged cell it touches, so a selection dragged across part of a merged cell
 * takes all of it.
 *
 * @public
 */
export function coveringArea(grid: TableGrid, area: CellArea): CellArea {
  let out = {
    row: Math.min(area.row, area.toRow),
    col: Math.min(area.col, area.toCol),
    toRow: Math.max(area.row, area.toRow),
    toCol: Math.max(area.col, area.toCol),
  };
  for (let grown = true; grown; ) {
    grown = false;
    for (const a of placed(grid).map(areaOf))
      if (overlaps(a, out) && !inside(a, out)) {
        out = { row: Math.min(out.row, a.row), col: Math.min(out.col, a.col), toRow: Math.max(out.toRow, a.toRow), toCol: Math.max(out.toCol, a.toCol) };
        grown = true;
      }
  }
  return out;
}

/** Whether `area` is a well-ordered rectangle inside `grid`. */
const inGrid = (grid: TableGrid, a: CellArea) =>
  a.row >= 0 && a.col >= 0 && a.toRow < grid.rows.length && a.toCol < grid.cols.length && a.toRow >= a.row && a.toCol >= a.col;

/** The texts of `cells` one after another, as one document; undefined when none has text. */
function joined(cells: readonly Placed[]): RichTextDoc | undefined {
  const docs = cells.flatMap((p) => (p.cell.text === undefined ? [] : [p.cell.text]));
  if (docs.length === 0) return undefined;
  return { ...(docs[0] as RichTextDoc), content: docs.flatMap((d) => d.content ?? []) };
}

/**
 * `grid` with the cells of `area` merged into its first cell, their texts joined in reading order and the first cell's style
 * kept; undefined when the area is one cell, out of the grid, or cuts through a merged cell (take {@link coveringArea} first).
 *
 * @public
 */
export function mergeCells(grid: TableGrid, area: CellArea): TableGrid | undefined {
  const { row, col, toRow, toCol } = area;
  if (!inGrid(grid, area) || (toRow === row && toCol === col)) return undefined;
  const all = placed(grid);
  if (all.some((p) => overlaps(areaOf(p), area) && !inside(areaOf(p), area))) return undefined;
  const taken = all.filter((p) => inside(areaOf(p), area)).sort((a, b) => a.row - b.row || a.col - b.col);
  const first = grid.cells[`${row}:${col}`] ?? {};
  const text = joined(taken);
  const { text: _text, ...base } = withSpan(withSpan(first, 'row', toRow - row + 1), 'col', toCol - col + 1);
  const merged: TableCell = text === undefined ? base : { ...base, text };
  const rest = all.filter((p) => !inside(areaOf(p), area));
  return { ...grid, cells: { ...keyed(rest), [`${row}:${col}`]: merged } };
}

/**
 * `grid` with the merged cell at `row`, `col` split back into its grid cells (the first keeps its text and style); undefined
 * when no merged cell starts there.
 *
 * @public
 */
export function splitCell(grid: TableGrid, row: number, col: number): TableGrid | undefined {
  const key = `${row}:${col}`;
  const cell = grid.cells[key];
  if (cell === undefined || (spanOf(cell, 'row') === 1 && spanOf(cell, 'col') === 1)) return undefined;
  return { ...grid, cells: { ...grid.cells, [key]: withSpan(withSpan(cell, 'row', 1), 'col', 1) } };
}

/** The grid cells (as `row * cols + col`) a merged cell covers beyond its first. */
function coveredIndices(grid: TableGrid): Set<number> {
  const cols = grid.cols.length;
  const covered = new Set<number>();
  for (const a of placed(grid).map(areaOf))
    for (let r = a.row; r <= a.toRow; r++) for (let c = a.col; c <= a.toCol; c++) if (r !== a.row || c !== a.col) covered.add(r * cols + c);
  return covered;
}

/**
 * The grid cell after (`step` 1) or before (`step` -1) the cell starting at `row`, `col` in reading order, skipping the cells a
 * merged cell covers: where Tab and Shift+Tab go. Undefined past the first or the last.
 *
 * @public
 */
export function stepCell(
  grid: TableGrid,
  row: number,
  col: number,
  step: 1 | -1,
):
  | {
      /** The cell's row. */
      readonly row: number;
      /** The cell's column. */
      readonly col: number;
    }
  | undefined {
  const cols = grid.cols.length;
  const covered = coveredIndices(grid);
  for (let i = row * cols + col + step; i >= 0 && i < grid.rows.length * cols; i += step)
    if (!covered.has(i)) return { row: Math.floor(i / cols), col: i % cols };
  return undefined;
}
