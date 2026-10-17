// The sparse non-uniform routing grid (ADR-0042, FR-CON-004): the lines a route may run along, not a
// cell per pixel. Vertical lines (`xs`) and horizontal lines (`ys`) sit one margin outside every
// obstacle edge, through every anchor stub, and midway across each gap wider than two margins; one
// line more outlines everything so a route can go around. The search (A*) walks the intersections.
// Everything is sorted and de-duplicated, so the same input gives the same grid (FR-RTE-004).
import { type Box, createStaticIndex, type IndexedBox, type Vec2 } from '@fluxion/geometry';

/**
 * What the grid is built from.
 *
 * @public
 */
export type GridInput = {
  /** The boxes a route must keep a margin away from. */
  readonly obstacles: readonly IndexedBox[];
  /** Points a route passes through: anchor stubs, and the ends themselves. */
  readonly stubs: readonly Vec2[];
  /** Clearance kept from an obstacle, px. */
  readonly margin: number;
  /** Only obstacles meeting this box shape the grid (the search window); all of them when absent. */
  readonly window?: Box | undefined;
};

/**
 * The grid: ascending, distinct coordinates of its vertical (`xs`) and horizontal (`ys`) lines.
 *
 * @public
 */
export type Grid = {
  /** x of each vertical line. */
  readonly xs: readonly number[];
  /** y of each horizontal line. */
  readonly ys: readonly number[];
};

/** Ascending distinct values (coordinates within 1e-9 are one). */
function distinct(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (last === undefined || v - last > 1e-9) out.push(v);
  }
  return out;
}

/** `lines` plus a midline in each gap wider than `2 * margin`. */
function withMidlines(lines: readonly number[], margin: number): number[] {
  const out = [...lines];
  for (let k = 1; k < lines.length; k++) {
    const a = lines[k - 1] as number;
    const b = lines[k] as number;
    if (b - a > 2 * margin) out.push((a + b) / 2);
  }
  return distinct(out);
}

/**
 * The sparse grid of `input`: lines one margin outside each obstacle edge and through each stub, a
 * midline across each wide gap, and an outline one margin beyond the extent of it all.
 *
 * @public
 */
export function buildGrid({ obstacles, stubs, margin, window }: GridInput): Grid {
  const index = createStaticIndex(obstacles);
  const hit = window === undefined ? undefined : new Set(index.search(window));
  const relevant = obstacles.filter((o) => hit === undefined || hit.has(o.id));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const { box } of relevant) {
    xs.push(box.x - margin, box.x + box.w + margin);
    ys.push(box.y - margin, box.y + box.h + margin);
  }
  for (const p of stubs) {
    xs.push(p.x);
    ys.push(p.y);
  }
  if (xs.length > 0) {
    xs.push(Math.min(...xs) - margin, Math.max(...xs) + margin);
    ys.push(Math.min(...ys) - margin, Math.max(...ys) + margin);
  }
  return { xs: withMidlines(distinct(xs), margin), ys: withMidlines(distinct(ys), margin) };
}
