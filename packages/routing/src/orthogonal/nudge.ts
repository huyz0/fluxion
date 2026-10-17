// Channel spreading (ADR-0042, FR-RTE-003): where segments of different routes run side by side closer than `spacing`, along the same
// stretch, they are pushed apart to `spacing`. A route's end segments never move, and a route that a push would send into an obstacle or
// fold back on itself keeps its unnudged shape.
import type { Box, Vec2 } from '@fluxion/geometry';

/**
 * A route to nudge and the boxes it must keep out of (already inflated by the clearance).
 *
 * @public
 */
export type NudgeRoute = {
  /** The corner points of the route. */
  readonly points: readonly Vec2[];
  /** Boxes the route may not enter. */
  readonly avoid?: readonly Box[] | undefined;
};

type Seg = { readonly route: number; readonly index: number; readonly horizontal: boolean; readonly line: number; readonly lo: number; readonly hi: number };

const PASSES = 6;

/** The segments of route `r` that may move: every one but the first and the last. */
function movable(points: readonly Vec2[], r: number): Seg[] {
  const out: Seg[] = [];
  for (let k = 1; k + 2 < points.length; k++) {
    const a = points[k] as Vec2;
    const b = points[k + 1] as Vec2;
    const horizontal = a.y === b.y;
    out.push({
      route: r,
      index: k,
      horizontal,
      line: horizontal ? a.y : a.x,
      lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
      hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
    });
  }
  return out;
}

/** Whether `a` and `b`, of different routes, run side by side closer than `spacing` over a stretch. */
const crowds = (a: Seg, b: Seg, spacing: number): boolean =>
  a.route !== b.route && a.horizontal === b.horizontal && Math.abs(a.line - b.line) < spacing && Math.min(a.hi, b.hi) > Math.max(a.lo, b.lo);

/** Clusters of segments that crowd each other, directly or through another, as lists of indexes into `segs`. */
function clusters(segs: readonly Seg[], spacing: number): number[][] {
  const parent = segs.map((_, i) => i);
  const find = (i: number): number => ((parent[i] as number) === i ? i : find(parent[i] as number));
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (crowds(segs[i] as Seg, segs[j] as Seg, spacing)) parent[find(j)] = find(i);
    }
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < segs.length; i++) byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), i]);
  return [...byRoot.values()].filter((c) => c.length > 1);
}

/** The shift of each segment of a cluster: spread evenly `spacing` apart, in order of their lines, around their mean; around a pinned route's segment instead when there is one, which stays. */
function shifts(segs: readonly Seg[], cluster: readonly number[], spacing: number, pinned: ReadonlySet<number>): Array<readonly [Seg, number]> {
  const members = cluster.map((i) => segs[i] as Seg).sort((a, b) => a.line - b.line || a.route - b.route || a.index - b.index);
  const mean = members.reduce((s, m) => s + m.line, 0) / members.length;
  const spot = (i: number): number => mean + (i - (members.length - 1) / 2) * spacing;
  const anchor = members.findIndex((m) => pinned.has(m.route));
  const base = anchor < 0 ? 0 : (members[anchor] as Seg).line - spot(anchor);
  return members.map((m, i) => [m, pinned.has(m.route) ? 0 : spot(i) + base - m.line] as const);
}

/** Whether the open segment `a`-`b` enters the interior of `box`. */
function enters(a: Vec2, b: Vec2, box: Box): boolean {
  return Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.w && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.h;
}

/** Whether every segment of `after` keeps the direction it had in `before` and keeps out of `avoid`. */
function sound(before: readonly Vec2[], after: readonly Vec2[], avoid: readonly Box[]): boolean {
  for (let k = 0; k + 1 < after.length; k++) {
    const [a, b, c, d] = [before[k] as Vec2, before[k + 1] as Vec2, after[k] as Vec2, after[k + 1] as Vec2];
    if (Math.sign(b.x - a.x) !== Math.sign(d.x - c.x) || Math.sign(b.y - a.y) !== Math.sign(d.y - c.y)) return false;
    if (avoid.some((o) => enters(c, d, o))) return false;
  }
  return true;
}

/** `points` with segment `k` shifted by `delta` across its direction. */
function shifted(points: readonly Vec2[], k: number, delta: number): Vec2[] {
  const horizontal = (points[k] as Vec2).y === (points[k + 1] as Vec2).y;
  return points.map((p, i) => (i === k || i === k + 1 ? (horizontal ? { x: p.x, y: p.y + delta } : { x: p.x + delta, y: p.y }) : p));
}

/** One pass: the routes with every cluster spread, a route keeping its shape (and so pinned) when its shifts are unsound. */
function pass(routes: readonly NudgeRoute[], current: readonly Vec2[][], spacing: number, pinned: Set<number>): { next: Vec2[][]; moved: boolean } {
  const segs = current.flatMap((points, r) => movable(points, r));
  const wanted: Array<Array<readonly [number, number]>> = current.map(() => []);
  for (const c of clusters(segs, spacing)) {
    for (const [seg, delta] of shifts(segs, c, spacing, pinned))
      if (Math.abs(delta) > 1e-9) (wanted[seg.route] as Array<readonly [number, number]>).push([seg.index, delta]);
  }
  let moved = false;
  const next = current.map((points, r) => {
    const list = wanted[r] as Array<readonly [number, number]>;
    if (list.length === 0) return points;
    const trial = list.reduce((p, [k, delta]) => shifted(p, k, delta), points as Vec2[]);
    if (!sound(points, trial, routes[r]?.avoid ?? [])) {
      pinned.add(r);
      moved = true;
      return points;
    }
    moved = true;
    return trial;
  });
  return { next, moved };
}

/**
 * The routes with segments that run side by side spread to at least `spacing` apart, in the order given; same input, same output.
 *
 * @public
 */
export function nudge(routes: readonly NudgeRoute[], spacing: number): Vec2[][] {
  let current = routes.map((r) => [...r.points]);
  const pinned = new Set<number>();
  for (let n = 0; n < PASSES; n++) {
    const { next, moved } = pass(routes, current, spacing, pinned);
    current = next;
    if (!moved) break;
  }
  return current;
}
