// A* over the sparse grid (ADR-0042, FR-CON-004): the cheapest axis-aligned path from `start` to
// `goal` that never enters an obstacle inflated by the margin. The cost of a path is its length plus
// `bendCost` for each turn plus `crossingCost` for each crossing of a segment of an earlier route (a route
// crosses where it arrives at a node that an earlier segment passes across).
// Ties are broken by a fixed order (estimate, then the deeper path, then node, then the order of discovery), so the same input
// always gives the same path (FR-RTE-004). The search is bounded: past `maxExpansions` it gives up.
import type { Box, Vec2 } from '@fluxion/geometry';
import type { Grid } from './grid.js';

/**
 * A segment of a route already placed, which a new route pays to cross.
 *
 * @public
 */
export type RouteSegment = {
  /** One end of the segment. */
  readonly from: Vec2;
  /** The other end. */
  readonly to: Vec2;
};

/**
 * What the search needs.
 *
 * @public
 */
export type SearchInput = {
  /** The grid; `start` and `goal` must lie on its lines (build it with them as stubs). */
  readonly grid: Grid;
  /** The boxes to keep clear of, before the margin is added (the connector's own ends are left out). */
  readonly obstacles: readonly Box[];
  /** Clearance kept from an obstacle, px. */
  readonly margin: number;
  /** Where the route starts. */
  readonly start: Vec2;
  /** Unit axis direction the route must leave `start` along; free when absent. */
  readonly startDir?: Vec2 | undefined;
  /** Where the route ends. */
  readonly goal: Vec2;
  /** Unit axis direction of the goal's anchor: the route arrives against it; free when absent. */
  readonly goalDir?: Vec2 | undefined;
  /** Cost of each turn, px of length. Default 40. */
  readonly bendCost?: number | undefined;
  /** Cost of crossing a segment of `existing`, px of length. Default 20. */
  readonly crossingCost?: number | undefined;
  /** Segments of routes already placed. */
  readonly existing?: readonly RouteSegment[] | undefined;
  /** Most nodes the search expands before it gives up. Default 20000. */
  readonly maxExpansions?: number | undefined;
};

const DIRS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
const dirIndex = (d: Vec2): number => DIRS.findIndex((e) => e.x === d.x && e.y === d.y);

type Entry = { readonly f: number; readonly g: number; readonly key: number; readonly order: number };
const before = (a: Entry, b: Entry): boolean =>
  a.f < b.f || (a.f === b.f && (a.g > b.g || (a.g === b.g && (a.key < b.key || (a.key === b.key && a.order < b.order)))));

/** A binary min-heap of entries ordered by `before`. */
class Heap {
  private readonly items: Entry[] = [];
  get size(): number {
    return this.items.length;
  }
  push(e: Entry): void {
    const a = this.items;
    a.push(e);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!before(a[i] as Entry, a[p] as Entry)) break;
      [a[i], a[p]] = [a[p] as Entry, a[i] as Entry];
      i = p;
    }
  }
  pop(): Entry | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (top === undefined || last === undefined) return undefined;
    if (a.length === 0) return top;
    a[0] = last;
    for (let i = 0; ; ) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < a.length && before(a[l] as Entry, a[m] as Entry)) m = l;
      if (r < a.length && before(a[r] as Entry, a[m] as Entry)) m = r;
      if (m === i) break;
      [a[i], a[m]] = [a[m] as Entry, a[i] as Entry];
      i = m;
    }
    return top;
  }
}

/** First index of `a` (ascending) with a value at least `v`. */
function lowerBound(a: readonly number[], v: number): number {
  let [lo, hi] = [0, a.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] as number) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index of `a` (ascending) with a value above `v`. */
function upperBound(a: readonly number[], v: number): number {
  let [lo, hi] = [0, a.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] as number) <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The index of the line within 1e-9 of `v` (the lines are ascending), or -1. */
function indexOfLine(lines: readonly number[], v: number): number {
  const k = lowerBound(lines, v - 1e-9);
  return k < lines.length && Math.abs((lines[k] as number) - v) < 1e-9 ? k : -1;
}

/** The grid steps that enter an obstacle's interior: `h[j * nx + i]` is the step from (i, j) to (i + 1, j), `v[j * nx + i]` the step from (i, j) to (i, j + 1). */
type Blocked = { readonly h: Uint8Array; readonly v: Uint8Array };

/** Sets `mark` over the columns `cols` and rows `rows` (half-open), kept to the `nx` by `ny` cells that start a step. */
function fill(mark: Uint8Array, nx: number, { cols, rows }: { readonly cols: readonly [number, number]; readonly rows: readonly [number, number] }): void {
  for (let j = Math.max(rows[0], 0); j < rows[1]; j++) for (let i = Math.max(cols[0], 0); i < Math.min(cols[1], nx); i++) mark[j * nx + i] = 1;
}

function blockedSteps(grid: Grid, boxes: readonly Box[]): Blocked {
  const [nx, ny] = [grid.xs.length, grid.ys.length];
  const blocked: Blocked = { h: new Uint8Array(nx * ny), v: new Uint8Array(nx * ny) };
  for (const box of boxes) {
    // the lines strictly inside the box on each axis; a step overlaps it from one line before the first inside to the last
    const [c0, c1] = [upperBound(grid.xs, box.x), lowerBound(grid.xs, box.x + box.w)];
    const [r0, r1] = [upperBound(grid.ys, box.y), lowerBound(grid.ys, box.y + box.h)];
    fill(blocked.h, nx, { cols: [c0 - 1, Math.min(c1, nx - 1)], rows: [r0, r1] });
    fill(blocked.v, nx, { cols: [c0, c1], rows: [r0 - 1, Math.min(r1, ny - 1)] });
  }
  return blocked;
}

/** The nodes the segments of earlier routes pass through (not at their ends), by the axis they run along, and the segments that do not lie on the grid. */
type Passes = { readonly h: Uint8Array; readonly v: Uint8Array; readonly loose: readonly RouteSegment[] };

/** Marks the nodes strictly inside the on-grid segment `s` in `mark`; false when it does not lie on the grid. */
function markSegment(grid: Grid, s: RouteSegment, passes: { readonly h: Uint8Array; readonly v: Uint8Array }): boolean {
  const nx = grid.xs.length;
  const [i0, i1, j0, j1] = [indexOfLine(grid.xs, s.from.x), indexOfLine(grid.xs, s.to.x), indexOfLine(grid.ys, s.from.y), indexOfLine(grid.ys, s.to.y)];
  if (i0 < 0 || i1 < 0 || j0 < 0 || j1 < 0 || (i0 !== i1 && j0 !== j1)) return false;
  if (i0 === i1) for (let j = Math.min(j0, j1) + 1; j < Math.max(j0, j1); j++) passes.v[j * nx + i0] = 1;
  else for (let i = Math.min(i0, i1) + 1; i < Math.max(i0, i1); i++) passes.h[j0 * nx + i] = 1;
  return true;
}

function passedNodes(grid: Grid, existing: readonly RouteSegment[]): Passes {
  const size = grid.xs.length * grid.ys.length;
  const passes = { h: new Uint8Array(size), v: new Uint8Array(size) };
  const loose = existing.filter((s) => !markSegment(grid, s, passes));
  return { ...passes, loose };
}

/** Whether the axis-aligned segment `a`-`b` properly crosses the axis-aligned `s` (a T or X, not a touch along it). */
function crosses(a: Vec2, b: Vec2, s: RouteSegment): boolean {
  const horizontal = a.y === b.y;
  const sHorizontal = s.from.y === s.to.y;
  if (horizontal === sHorizontal) return false;
  const [h0, h1, hy, v0, v1, vx] = horizontal
    ? [Math.min(a.x, b.x), Math.max(a.x, b.x), a.y, Math.min(s.from.y, s.to.y), Math.max(s.from.y, s.to.y), s.from.x]
    : [Math.min(s.from.x, s.to.x), Math.max(s.from.x, s.to.x), s.from.y, Math.min(a.y, b.y), Math.max(a.y, b.y), a.x];
  return vx > (h0 as number) && vx < (h1 as number) && (hy as number) > (v0 as number) && (hy as number) < (v1 as number);
}

/** `path` without the points that lie on a straight run between their neighbours. */
function corners(path: readonly Vec2[]): Vec2[] {
  return path.filter((p, k) => {
    const a = path[k - 1];
    const b = path[k + 1];
    return a === undefined || b === undefined || !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

type Context = {
  readonly input: SearchInput;
  readonly nx: number;
  readonly ny: number;
  readonly gi: number;
  readonly gj: number;
  readonly startDir: number;
  readonly arrive: number;
  readonly bendCost: number;
  readonly crossingCost: number;
  readonly blocked: Blocked;
  readonly passes: Passes;
  /** The node the search starts from: the only one with no heading. */
  readonly startKey: number;
  /** Cheapest cost found to each node (Infinity: not reached), indexed by node. */
  readonly best: Float64Array;
  /** The node each node was reached from (-1: none), indexed by node. */
  readonly from: Int32Array;
  readonly heap: Heap;
  order: number;
};

const at = (c: Context, i: number, j: number): Vec2 => ({ x: c.input.grid.xs[i] as number, y: c.input.grid.ys[j] as number });
const node = (c: Context, i: number, j: number, d: number): number => (j * c.nx + i) * 4 + d;
/** A lower bound on what is left: the distance to the goal, and a bend when the goal shares neither its row nor its column. */
const heuristic = (c: Context, i: number, j: number): number =>
  Math.abs((c.input.grid.xs[i] as number) - c.input.goal.x) +
  Math.abs((c.input.grid.ys[j] as number) - c.input.goal.y) +
  (i === c.gi || j === c.gj ? 0 : c.bendCost);

/** The cost of the step `a`-`b`: its length, `extra` (a bend, a crossing at the node), and each off-grid segment it crosses. */
function stepCost(c: Context, a: Vec2, b: Vec2, extra: number): number {
  const loose = c.passes.loose.reduce((n, s) => n + (crosses(a, b, s) ? c.crossingCost : 0), 0);
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + extra + loose;
}

/** Whether the step from (`i`, `j`) heading `nd` enters an obstacle. */
function blockedStep(c: Context, { i, j }: { readonly i: number; readonly j: number }, nd: number): boolean {
  const nx = c.nx;
  if (nd === 0) return c.blocked.h[j * nx + i] === 1;
  if (nd === 2) return c.blocked.h[j * nx + i - 1] === 1;
  return nd === 1 ? c.blocked.v[j * nx + i] === 1 : c.blocked.v[(j - 1) * nx + i] === 1;
}

/** The extra cost of the step into node (`ni`, `nj`) heading `nd` after heading `d`: a bend, and a crossing when an earlier segment passes across the node. */
function turnCost(c: Context, { ni, nj }: { readonly ni: number; readonly nj: number }, d: number, nd: number): number {
  const across = nd % 2 === 0 ? c.passes.v : c.passes.h;
  return (d >= 0 && nd !== d ? c.bendCost : 0) + (across[nj * c.nx + ni] === 1 ? c.crossingCost : 0);
}

/** Whether a node with heading `d` may turn to `nd`: the start obeys `startDir`, and nothing reverses. */
const mayTurn = (c: Context, d: number, nd: number): boolean => (d < 0 ? c.startDir < 0 || nd === c.startDir : (nd + 2) % 4 !== d);

/** Relax every neighbour of the node `cur`, which sits at cell (`i`, `j`) heading `d`. */
function expand(c: Context, cur: Entry, at0: { readonly i: number; readonly j: number; readonly d: number }): void {
  const { i, j, d } = at0;
  for (let nd = 0; nd < 4; nd++) {
    const dir = DIRS[nd] as Vec2;
    const ni = i + dir.x;
    const nj = j + dir.y;
    if (!mayTurn(c, d, nd) || ni < 0 || nj < 0 || ni >= c.nx || nj >= c.ny) continue;
    const a = at(c, i, j);
    const b = at(c, ni, nj);
    if (blockedStep(c, { i, j }, nd)) continue;
    const g = cur.g + stepCost(c, a, b, turnCost(c, { ni, nj }, d, nd));
    const key = node(c, ni, nj, nd);
    if (g >= (c.best[key] as number)) continue;
    c.best[key] = g;
    c.from[key] = cur.key;
    c.heap.push({ f: g + heuristic(c, ni, nj), g, key, order: c.order++ });
  }
}

/** The corner points of the path that ends at node `end`. */
function trace(c: Context, end: number): Vec2[] {
  const cells: Vec2[] = [];
  for (let k = end; k >= 0; k = c.from[k] as number) {
    const cell = k >> 2;
    cells.push(at(c, cell % c.nx, (cell - (cell % c.nx)) / c.nx));
  }
  return corners(cells.reverse());
}

/** Whether cell (`i`, `j`) entered heading `d` ends the route: it is the goal, arrived at the way the anchor asks. */
const reached = (c: Context, i: number, j: number, d: number): boolean => i === c.gi && j === c.gj && (c.arrive < 0 || d === c.arrive);

/** The search state for `input`, seeded with the start node, or undefined when an end is off the grid. */
function begin(input: SearchInput): Context | undefined {
  const { grid, margin, start, goal } = input;
  const si = indexOfLine(grid.xs, start.x);
  const sj = indexOfLine(grid.ys, start.y);
  const gi = indexOfLine(grid.xs, goal.x);
  const gj = indexOfLine(grid.ys, goal.y);
  if (si < 0 || sj < 0 || gi < 0 || gj < 0) return undefined;
  const c: Context = {
    input,
    nx: grid.xs.length,
    ny: grid.ys.length,
    gi,
    gj,
    startDir: input.startDir === undefined ? -1 : dirIndex(input.startDir),
    // the route arrives against the goal anchor's direction
    arrive: input.goalDir === undefined ? -1 : dirIndex({ x: -input.goalDir.x, y: -input.goalDir.y }),
    bendCost: input.bendCost ?? 40,
    crossingCost: input.crossingCost ?? 20,
    blocked: blockedSteps(
      grid,
      input.obstacles.map((o): Box => ({ x: o.x - margin, y: o.y - margin, w: o.w + 2 * margin, h: o.h + 2 * margin })),
    ),
    passes: passedNodes(grid, input.existing ?? []),
    startKey: (sj * grid.xs.length + si) * 4,
    best: new Float64Array(grid.xs.length * grid.ys.length * 4).fill(Infinity),
    from: new Int32Array(grid.xs.length * grid.ys.length * 4).fill(-1),
    heap: new Heap(),
    order: 0,
  };
  // the start has no heading yet: it leaves along each allowed direction
  const startNode = c.startKey;
  c.best[startNode] = 0;
  c.heap.push({ f: heuristic(c, si, sj), g: 0, key: startNode, order: c.order++ });
  return c;
}

/** Expands nodes of `c` cheapest first until the goal is reached (its path) or the search bound `limit` or the open nodes run out. */
function run(c: Context, limit: number): Vec2[] | undefined {
  for (let expansions = 0; c.heap.size > 0; ) {
    const cur = c.heap.pop() as Entry;
    if (cur.g > (c.best[cur.key] as number)) continue;
    const d = cur.key === c.startKey ? -1 : cur.key & 3;
    const cell = cur.key >> 2;
    const i = cell % c.nx;
    const j = (cell - i) / c.nx;
    if (reached(c, i, j, d)) return trace(c, cur.key);
    if (++expansions > limit) return undefined;
    expand(c, cur, { i, j, d });
  }
  return undefined;
}

/**
 * The cheapest axis-aligned path from `start` to `goal` as its corner points (collinear points
 * dropped), or undefined when the goal cannot be reached inside the search bound.
 *
 * @public
 */
export function searchRoute(input: SearchInput): Vec2[] | undefined {
  if (input.start.x === input.goal.x && input.start.y === input.goal.y) return [input.start];
  const c = begin(input);
  return c === undefined ? undefined : run(c, input.maxExpansions ?? 20000);
}
