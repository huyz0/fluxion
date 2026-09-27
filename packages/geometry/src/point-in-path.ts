import { type CubicSegment, extremaParams, type Path, pointAt } from './path.js';
import type { Vec2 } from './vec2.js';

/**
 * Fill rule deciding which regions of a self-overlapping path are inside.
 *
 * @public
 */
export type FillRule = 'nonzero' | 'evenodd';

/** Bisection steps: each halves the parameter interval, so 60 reach double precision. */
const BISECT_STEPS = 60;

/** A piece of a segment over `[t0, t1]` on which y only rises or only falls. */
type Monotone = { readonly seg: CubicSegment; readonly t0: number; readonly t1: number };

/** The segment cut at its y extrema into y-monotone pieces. */
function monotonePieces(seg: CubicSegment): Monotone[] {
  const ts = [0, ...[...extremaParams(seg.p0.y, seg.p1.y, seg.p2.y, seg.p3.y)].sort((a, b) => a - b), 1];
  return ts.slice(1).map((t1, i) => ({ seg, t0: ts[i] ?? 0, t1 }));
}

/**
 * Signed crossing of the horizontal ray from `p` towards +x by a monotone piece: +1 rising, -1
 * falling, 0 none. Half-open in y (the lower end counts, the upper does not), so a ray through a
 * joint counts it once. The crossing is found by bisection on the exact curve, not a polyline.
 */
function crossing(piece: Monotone, p: Vec2): number {
  const y0 = pointAt(piece.seg, piece.t0).y;
  const y1 = pointAt(piece.seg, piece.t1).y;
  const rising = y0 < y1;
  if (!(rising ? y0 <= p.y && p.y < y1 : y1 <= p.y && p.y < y0)) return 0;
  let lo = piece.t0;
  let hi = piece.t1;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (pointAt(piece.seg, mid).y < p.y === rising) lo = mid;
    else hi = mid;
  }
  if (pointAt(piece.seg, (lo + hi) / 2).x <= p.x) return 0;
  return rising ? 1 : -1;
}

/** The segments of `path` plus, for an open path, the straight line back to its start. */
function closedSegments(path: Path): readonly CubicSegment[] {
  const first = path.segments[0];
  const last = path.segments.at(-1);
  if (first === undefined || last === undefined || (last.p3.x === first.p0.x && last.p3.y === first.p0.y)) return path.segments;
  const [a, b] = [last.p3, first.p0];
  const at = (k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  return [...path.segments, { p0: a, p1: at(1 / 3), p2: at(2 / 3), p3: b }];
}

/**
 * True when `p` is inside `path` under the fill rule, tested against the exact curves (ray
 * crossings found on each y-monotone piece of every cubic, M2.16 review F2). An open path is
 * treated as closed by a straight line back to its start. Points exactly on the outline may go
 * either way.
 *
 * @public
 */
export function pointInPath(path: Path, p: Vec2, rule: FillRule = 'nonzero'): boolean {
  let winding = 0;
  let crossings = 0;
  for (const seg of closedSegments(path)) {
    for (const piece of monotonePieces(seg)) {
      const c = crossing(piece, p);
      winding += c;
      crossings += Math.abs(c);
    }
  }
  return rule === 'evenodd' ? crossings % 2 === 1 : winding !== 0;
}
