// The miter joins of a stroke (FR-EDT-004, M6.10 review F1): at a corner, a miter-joined stroke draws
// a spike past the band of half its width along the outline, out to where its two outer edges meet,
// unless that is more than MITER_LIMIT widths out (SVG's default `stroke-miterlimit`), where SVG bevels
// instead. Hit-testing adds these spikes to the stroke. Pure geometry on core's evaluated paths.
import { add, type CubicSegment, cross, derivativeAt, dot, length, normalize, type Path, scale, sub, type Vec2 } from '@fluxion/geometry';

/**
 * SVG's default miter limit: a miter longer than this many stroke widths is bevelled.
 *
 * @public
 */
export const MITER_LIMIT = 4;

/**
 * A miter spike: its tip, then the corners of the stroke's two outer edges at the joint.
 *
 * @public
 */
export type Wedge = readonly [tip: Vec2, a: Vec2, b: Vec2];

/** Below this, a turn is straight on. */
const JOINT_EPS = 1e-6;

/** The wedge at a joint `v` from direction `d1` into direction `d2`, for a half-width `hw`. */
function wedgeAt(v: Vec2, d1: Vec2, d2: Vec2, hw: number): Wedge | undefined {
  const turn = cross(d1, d2);
  // straight on, or doubling back (a reversal's miter is infinitely long, so bevelled): no spike
  // tzap disable next-line EqualityOperator: a turn of exactly JOINT_EPS
  if (Math.abs(turn) < JOINT_EPS) return undefined;
  // the outer side is the one the path turns away from
  // tzap disable next-line EqualityOperator: a turn of 0 has returned above
  const outer = (d: Vec2): Vec2 => (turn > 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x });
  const n1 = outer(d1);
  const n2 = outer(d2);
  const s = add(n1, n2);
  const len = length(s);
  // the miter's length over the stroke's width is 1 / cos(half the angle between the normals) = 2 / |n1 + n2|
  // tzap disable next-line EqualityOperator: a miter of exactly the limit
  if (2 / len > MITER_LIMIT) return undefined;
  return [add(v, scale(s, (2 * hw) / (len * len))), add(v, scale(n1, hw)), add(v, scale(n2, hw))];
}

/**
 * The miter spikes a stroke of half-width `hw` draws at the joints of `path` (between consecutive
 * segments, and where a closed path returns to its start).
 *
 * @public
 */
export function miterWedges(path: Path, hw: number): Wedge[] {
  // a path's segments are consecutive, each starting where the one before ends; a closed path's last
  // joins its first
  // tzap disable next-line ConditionalExpression, EqualityOperator: a closed path has two segments at least (its closing line)
  const joints = path.closed && path.segments.length > 1 ? [...path.segments, path.segments[0] as CubicSegment] : path.segments;
  const out: Wedge[] = [];
  for (let i = 1; i < joints.length; i++) {
    const a = joints[i - 1] as CubicSegment;
    // a tangent of length 0 (a control point on its end) normalizes to 0: no turn, so no spike
    const w = wedgeAt(a.p3, normalize(derivativeAt(a, 1)), normalize(derivativeAt(joints[i] as CubicSegment, 0)), hw);
    if (w !== undefined) out.push(w);
  }
  return out;
}

/** The distance from `p` to the segment `a`-`b`. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / dot(ab, ab)));
  return length(sub(p, add(a, scale(ab, t))));
}

/**
 * Whether `p` is inside the wedge `w` or within `tolerance` of it.
 *
 * @public
 */
export function nearWedge(p: Vec2, w: Wedge, tolerance: number): boolean {
  const [t, a, b] = w;
  const side = (u: Vec2, v: Vec2) => cross(sub(v, u), sub(p, u));
  const s1 = side(t, a);
  const s2 = side(a, b);
  const s3 = side(b, t);
  // tzap disable next-line EqualityOperator: a point exactly on an edge, which the tolerance covers anyway
  const inside = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  // tzap disable next-line EqualityOperator: a point exactly the tolerance away
  return inside || Math.min(segmentDistance(p, t, a), segmentDistance(p, a, b), segmentDistance(p, b, t)) <= tolerance;
}
