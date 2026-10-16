// The built-in `grid` layout (05 §3, FR-LAY-002): unpinned nodes in model order, row by row, in equal cells of the widest and tallest
// box, from the padded start of the frame; a node sits in its cell at the start, centre or end. Pinned nodes keep their boxes and the
// grid skips any cell they would overlap. Cell edges are on the half-pixel grid and never move a box back, so cells never overlap.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import type { LayoutAlgorithm, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `grid` layout.
 *
 * @public
 */
export type GridOptions = {
  /** Cells per row, 1 to 64 (default 3). */
  readonly columns: number;
  /** Space between cells, px (default 24). */
  readonly gap: number;
  /** Where a box sits in its cell, on both axes (default `start`). */
  readonly align: 'start' | 'center' | 'end';
  /** Space between the frame's edge and the grid, px (default 80). */
  readonly padding: number;
};

const DEFAULTS: GridOptions = { columns: 3, gap: 24, align: 'start', padding: 80 };
const KEYS = new Set(Object.keys(DEFAULTS));
const MAX_COLUMNS = 64;

// edges round forward to the half pixel, never back: a cell edge that moved back could pull a box over its neighbour or a pin
const up = (n: number) => Math.ceil(n * 2) / 2 || 0;
const down = (n: number) => Math.floor(n * 2) / 2 || 0;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const fail = (message: string): OptionsResult<GridOptions> => ({ ok: false, message });
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One option's value, or why it is refused. */
function option(key: string, value: unknown): string | undefined {
  if (key === 'align') return value === 'start' || value === 'center' || value === 'end' ? undefined : 'align must be "start", "center" or "end"';
  if (key === 'columns') {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_COLUMNS
      ? undefined
      : `columns must be a whole number from 1 to ${MAX_COLUMNS}`;
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? undefined : `${key} must be a number of px, 0 or more`;
}

function parseOptions(raw: unknown): OptionsResult<GridOptions> {
  if (raw === undefined) return { ok: true, value: DEFAULTS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('grid options must be an object');
  const given = Object.entries(raw).filter(([, value]) => value !== undefined);
  for (const [key, value] of given) {
    if (!KEYS.has(key)) return fail(`unknown grid option "${key}" (columns, gap, align, padding)`);
    const problem = option(key, value);
    if (problem) return fail(problem);
  }
  return { ok: true, value: { ...DEFAULTS, ...(Object.fromEntries(given) as Partial<GridOptions>) } };
}

/** The offset of a box of `size` in a cell of `cell`, rounded back to the half pixel so the box stays inside the cell. */
function offset(align: GridOptions['align'], cell: number, size: number): number {
  const slack = cell - size;
  return down(align === 'start' ? 0 : align === 'center' ? slack / 2 : slack);
}

/** Where the grid starts and how far apart its cells are (at least 1 px, so that every row and column moves on). */
type Cells = {
  readonly startX: number;
  readonly startY: number;
  readonly strideX: number;
  readonly strideY: number;
  readonly cellW: number;
  readonly cellH: number;
};

/** The box of `n` in cell number `cell`. */
function boxIn(c: Cells, o: GridOptions, n: LayoutNode, cell: number): Box {
  const [col, row] = [cell % o.columns, Math.floor(cell / o.columns)];
  return {
    x: c.startX + col * c.strideX + offset(o.align, c.cellW, n.box.w),
    y: c.startY + row * c.strideY + offset(o.align, c.cellH, n.box.h),
    w: n.box.w,
    h: n.box.h,
  };
}

/** Skipping cells that pins cover is bounded: after this many tries a box goes to the first row below every pin. */
const MAX_TRIES = 100_000;

function run(input: LayoutInput, o: GridOptions): LayoutOutput {
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  const pinned = nodes.filter((n) => n.pinned).map((n) => n.box);
  const loose = nodes.filter((n) => !n.pinned);
  const cellW = up(Math.max(0, ...loose.map((n) => n.box.w)));
  const cellH = up(Math.max(0, ...loose.map((n) => n.box.h)));
  const cells: Cells = {
    startX: up(input.frame.x + o.padding),
    startY: up(input.frame.y + o.padding),
    strideX: Math.max(1, cellW + up(o.gap)),
    strideY: Math.max(1, cellH + up(o.gap)),
    cellW,
    cellH,
  };
  const below = Math.max(0, ...pinned.map((p) => p.y + p.h));
  // a Map, then fromEntries: a record id may be `__proto__`, which an assignment to a plain object would not keep as a key
  const boxes = new Map<string, Box>();
  for (const n of nodes) if (n.pinned) boxes.set(n.id, n.box);
  let [cell, tries] = [0, 0];
  for (const n of loose) {
    let box = boxIn(cells, o, n, cell);
    for (cell += 1, tries += 1; pinned.some((p) => overlaps(box, p)); cell += 1, tries += 1) {
      // past the limit, jump to the first full row under every pin: nothing there can overlap one
      if (tries === MAX_TRIES) cell = Math.max(cell, o.columns * (Math.ceil((below - cells.startY) / cells.strideY) + 1));
      box = boxIn(cells, o, n, cell);
    }
    boxes.set(n.id, box);
  }
  return { boxes: Object.fromEntries(boxes) };
}

/**
 * The `grid` layout.
 *
 * @public
 */
export const gridLayout: LayoutAlgorithm<GridOptions> = {
  id: 'grid',
  describe: 'Boxes in rows and columns, in reading order.',
  version: '1',
  schema: z
    .strictObject({
      columns: z.number().int().min(1).max(MAX_COLUMNS).default(DEFAULTS.columns),
      gap: z.number().finite().min(0).default(DEFAULTS.gap),
      align: z.enum(['start', 'center', 'end']).default(DEFAULTS.align),
      padding: z.number().finite().min(0).default(DEFAULTS.padding),
    })
    .default(DEFAULTS),
  capabilities: { pins: true, compound: false, runsIn: 'either' },
  parseOptions,
  run,
};
