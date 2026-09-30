// How far a point is from an outline, when that is within a limit (FR-EDT-004, M6 cp1 F1): what
// hit-testing asks of every candidate, many times a second. Segments whose bounds lie beyond the
// limit are skipped, and a straight segment (every outline edge of a rectangle, a line, a straight
// route) is measured exactly; only a curve within reach falls back to geometry's sampled search.
import { type Box, type CubicSegment, nearestPoint, type Path, segmentBounds, type Vec2 } from '@fluxion/geometry';

/** A segment as measured: its bounds, and for a straight one its two ends. */
type Measured = { readonly seg: CubicSegment; readonly bounds: Box; readonly line: boolean };

/** Each path's segments measured once (outlines are evaluated once per element and kept). */
const measured = new WeakMap<Path, readonly Measured[]>();

/**
 * Whether `c` lies on the chord from `a` to `b` (on its line within a relative epsilon, and between its
 * ends): a control point of a straight segment. A control point beyond an end bends the curve past it.
 */
const onChord = (a: Vec2, b: Vec2, c: Vec2): boolean => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  // a chord of no length: straight only if the control sits on its one point
  if (length2 === 0) return c.x === a.x && c.y === a.y;
  const cross = dx * (c.y - a.y) - dy * (c.x - a.x);
  const along = (c.x - a.x) * dx + (c.y - a.y) * dy;
  // tzap disable next-line EqualityOperator: a control point exactly on the tolerance or an end
  return Math.abs(cross) <= 1e-9 * length2 && along >= 0 && along <= length2;
};

/**
 * Whether a cubic segment is straight: both control points on the chord between its ends, where the
 * distance to it is measured exactly (the fast path of hit-testing).
 */
export const straight = (seg: CubicSegment): boolean => onChord(seg.p0, seg.p3, seg.p1) && onChord(seg.p0, seg.p3, seg.p2);

function measure(path: Path): readonly Measured[] {
  const known = measured.get(path);
  // tzap disable next-line ConditionalExpression, LogicalOperator: a cache; without it the segments are measured again
  if (known !== undefined) return known;
  const made = path.segments.map((seg) => ({ seg, bounds: segmentBounds(seg), line: straight(seg) }));
  // tzap disable next-line CallExpression: a cache; without it the segments are measured again
  measured.set(path, made);
  return made;
}

/** The distance from `p` to the box `b` (0 inside it). */
function boxDistance(b: Box, p: Vec2): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** The distance from `p` to the straight segment `a`-`b`. */
function lineDistance(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The distance from `p` to the outline `path` when it is at most `limit`; otherwise some number
 * above `limit` (Infinity when no segment comes that close).
 *
 * @public
 */
export function distanceWithin(path: Path, p: Vec2, limit: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const m of measure(path)) {
    if (boxDistance(m.bounds, p) > Math.min(limit, best)) continue;
    // tzap disable next-line BooleanLiteral: an open or closed one-segment path is measured alike
    const d = m.line ? lineDistance(m.seg.p0, m.seg.p3, p) : (nearestPoint({ segments: [m.seg], closed: false }, p)?.distance ?? best);
    // tzap disable next-line ConditionalExpression, EqualityOperator: an equal distance changes nothing
    if (d < best) best = d;
  }
  return best;
}
