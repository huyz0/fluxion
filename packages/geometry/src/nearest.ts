import { type CubicSegment, type Path, pointAt } from './path.js';
import { distance, type Vec2 } from './vec2.js';

/**
 * The closest point of a path to a query point.
 *
 * @public
 */
export type NearestPoint = {
  /** Closest point on the path. */
  readonly point: Vec2;
  /** Distance from the query point to `point`. */
  readonly distance: number;
  /** Index of the segment containing `point`. */
  readonly segment: number;
  /** Parameter of `point` within that segment. */
  readonly t: number;
};

const COARSE_SAMPLES = 64;
const REFINE_STEPS = 60;

type Candidate = { readonly t: number; readonly d: number };

/** Golden-section search for the minimum distance within `[lo, hi]`. */
function refine(seg: CubicSegment, p: Vec2, lo: number, hi: number): Candidate {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  for (let i = 0; i < REFINE_STEPS; i++) {
    const m1 = b - ratio * (b - a);
    const m2 = a + ratio * (b - a);
    if (distance(pointAt(seg, m1), p) <= distance(pointAt(seg, m2), p)) b = m2;
    else a = m1;
  }
  const t = (a + b) / 2;
  return { t, d: distance(pointAt(seg, t), p) };
}

/** Best parameter on one segment: coarse samples, then refinement around every local minimum. */
function nearestOnSegment(seg: CubicSegment, p: Vec2): Candidate {
  const ds: number[] = [];
  for (let i = 0; i <= COARSE_SAMPLES; i++) ds.push(distance(pointAt(seg, i / COARSE_SAMPLES), p));
  let best: Candidate = { t: 0, d: Number.POSITIVE_INFINITY };
  for (const [i, d] of ds.entries()) {
    const isLocalMin = d <= (ds[i - 1] ?? Number.POSITIVE_INFINITY) && d <= (ds[i + 1] ?? Number.POSITIVE_INFINITY);
    if (!isLocalMin) continue;
    const refined = refine(seg, p, Math.max(0, (i - 1) / COARSE_SAMPLES), Math.min(1, (i + 1) / COARSE_SAMPLES));
    const local = refined.d < d ? refined : { t: i / COARSE_SAMPLES, d };
    if (local.d < best.d) best = local;
  }
  return best;
}

/** The distance from `p` to the box around `seg`'s control points, which holds the whole segment: no point of it is nearer. */
function hullDistance(seg: CubicSegment, p: Vec2): number {
  const xs = [seg.p0.x, seg.p1.x, seg.p2.x, seg.p3.x];
  const ys = [seg.p0.y, seg.p1.y, seg.p2.y, seg.p3.y];
  const dx = Math.max(Math.min(...xs) - p.x, 0, p.x - Math.max(...xs));
  const dy = Math.max(Math.min(...ys) - p.y, 0, p.y - Math.max(...ys));
  return Math.hypot(dx, dy);
}

/**
 * Closest point of `path` to `p`, or `null` when the path has no segments. Of segments equally near, the first. Segments are searched
 * nearest box first, and one whose box is farther than the best point found is skipped (NFR-PERF-002: snapping a point on an outline back
 * to it searches one segment, not all of them); the answer is the one a search of every segment gives.
 *
 * @public
 */
export function nearestPoint(path: Path, p: Vec2): NearestPoint | null {
  const order = path.segments.map((seg, index) => ({ seg, index, hull: hullDistance(seg, p) })).sort((a, b) => a.hull - b.hull || a.index - b.index);
  let result: NearestPoint | null = null;
  for (const { seg, index, hull } of order) {
    if (result !== null && hull > result.distance) break;
    const c = nearestOnSegment(seg, p);
    if (result === null || c.d < result.distance || (c.d === result.distance && index < result.segment)) {
      result = { point: pointAt(seg, c.t), distance: c.d, segment: index, t: c.t };
    }
  }
  return result;
}
