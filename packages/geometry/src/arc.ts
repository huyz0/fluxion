// SVG elliptical arcs as cubic segments (ADR-0016): the endpoint-to-centre conversion of SVG 1.1
// appendix F.6.5, radii scaled up when too small (F.6.6), then at most 90° per cubic.
import type { CubicSegment } from './path.js';
import type { Vec2 } from './vec2.js';

/**
 * The arc parameters of an SVG `A` command, in absolute coordinates.
 *
 * @public
 */
export type ArcSpec = {
  /** Horizontal radius (its sign is ignored). */
  readonly rx: number;
  /** Vertical radius (its sign is ignored). */
  readonly ry: number;
  /** Rotation of the ellipse's x-axis, in degrees. */
  readonly rotation: number;
  /** Take the arc of more than 180°. */
  readonly largeArc: boolean;
  /** Draw in the direction of increasing angle. */
  readonly sweep: boolean;
  /** End point. */
  readonly to: Vec2;
};

const QUARTER = Math.PI / 2;

/** The point a third of the way from `a` to `b`, as a weighted sum: no overflow for far-apart finite points. */
function third(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x * (2 / 3) + b.x / 3, y: a.y * (2 / 3) + b.y / 3 };
}

/** Signed angle from `u` to `v`. */
function angle(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

type Ellipse = { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number; readonly cos: number; readonly sin: number };

/** `delta` turned the way the sweep flag asks (F.6.5.6). */
function directed(delta: number, positive: boolean): number {
  // tzap disable next-line EqualityOperator: delta is never 0 (equal endpoints return before this)
  if (!positive && delta > 0) return delta - 2 * Math.PI;
  // tzap disable next-line EqualityOperator: delta is never 0 (equal endpoints return before this)
  if (positive && delta < 0) return delta + 2 * Math.PI;
  return delta;
}

/**
 * Centre, radii and angles of the arc from `from` (F.6.5, with F.6.6's radius correction), computed
 * in the ellipse's unit frame so tiny or huge radii rarely overflow or underflow (arcToCubics checks
 * the result).
 */
function centre(from: Vec2, a: ArcSpec): { readonly e: Ellipse; readonly start: number; readonly sweep: number } {
  const phi = (a.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - a.to.x) / 2;
  const dy = (from.y - a.to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let rx = Math.abs(a.rx);
  let ry = Math.abs(a.ry);
  // tzap disable next-line EqualityOperator: at exactly 1 the scaling changes nothing
  if (!(Math.hypot(x1 / rx, y1 / ry) <= 1)) {
    // too small: the smallest ellipse of the same proportions through both points
    const ratio = ry / rx;
    rx = Math.hypot(x1, y1 / ratio);
    ry = rx * ratio;
  }
  const [u, v] = [x1 / rx, y1 / ry];
  const coef = (a.largeArc === a.sweep ? -1 : 1) * Math.sqrt(Math.max(0, 1 / (u * u + v * v) - 1));
  const [cu, cv] = [coef * v, -coef * u];
  const e = { cx: cos * cu * rx - sin * cv * ry + (from.x + a.to.x) / 2, cy: sin * cu * rx + cos * cv * ry + (from.y + a.to.y) / 2, rx, ry, cos, sin };
  const start = angle(1, 0, u - cu, v - cv);
  return { e, start, sweep: directed(angle(u - cu, v - cv, -u - cu, -v - cv), a.sweep) };
}

/** The point of the unit circle's `(x, y)` on the ellipse. */
function place(e: Ellipse, x: number, y: number): Vec2 {
  return { x: e.cx + e.rx * e.cos * x - e.ry * e.sin * y, y: e.cy + e.rx * e.sin * x + e.ry * e.cos * y };
}

/** The derivative of the ellipse's point at angle `t`. */
function tangent(e: Ellipse, t: number): Vec2 {
  const [c, s] = [Math.cos(t), Math.sin(t)];
  return { x: -e.rx * e.cos * s - e.ry * e.sin * c, y: -e.rx * e.sin * s + e.ry * e.cos * c };
}

/**
 * The SVG arc from `from` as cubic segments of at most 90° each, starting exactly at `from` and
 * ending exactly at `arc.to`. A zero radius gives the straight line; equal endpoints give no
 * segment (both as SVG draws them); radii too small are scaled up to reach, and radii so large
 * that the arc cannot be told from its chord give the straight line.
 *
 * @public
 */
export function arcToCubics(from: Vec2, arc: ArcSpec): readonly CubicSegment[] {
  // tzap disable next-line ConditionalExpression: without it the NaN centre also yields no segment; the guard states it
  if (from.x === arc.to.x && from.y === arc.to.y) return [];
  const chord = [{ p0: from, p1: third(from, arc.to), p2: third(arc.to, from), p3: arc.to }];
  // tzap disable next-line ConditionalExpression,LogicalOperator: a zero radius also ends in the chord below (its centre is not finite); this states SVG's rule
  if (arc.rx === 0 || arc.ry === 0) return chord;
  const segments = curve(from, arc);
  // radii at the edges of the number range (a centre, ratio or angle that is not finite) give the chord
  // tzap disable next-line MethodExpression: an overflowing centre or ratio spoils every coordinate at once; no input gives a partly finite arc
  return segments.length > 0 && segments.every(isFiniteSegment) ? segments : chord;
}

// tzap disable next-line MethodExpression,LogicalOperator: as above, x and y and all points turn non-finite together
const isFiniteSegment = (s: CubicSegment): boolean => [s.p1, s.p2, s.p3].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

/** The arc as cubics of at most 90°; not finite when the radii overflow the number range. */
function curve(from: Vec2, arc: ArcSpec): CubicSegment[] {
  const { e, start, sweep } = centre(from, arc);
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / QUARTER - 1e-9));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  // the joints once, so each segment starts exactly where the previous one ends
  const at = (i: number) => start + i * step;
  const joints = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? from : i === n ? arc.to : place(e, Math.cos(at(i)), Math.sin(at(i)))));
  return joints.slice(1).map((p3, i) => {
    // controls from the joints along the tangents: no cancellation against a far-away centre
    const p0 = joints[i] as Vec2;
    const [ta, tb] = [tangent(e, at(i)), tangent(e, at(i + 1))];
    return { p0, p1: { x: p0.x + k * ta.x, y: p0.y + k * ta.y }, p2: { x: p3.x - k * tb.x, y: p3.y - k * tb.y }, p3 };
  });
}
