/**
 * An immutable 2D vector or point.
 *
 * @public
 */
export type Vec2 = {
  /** Horizontal component. */
  readonly x: number;
  /** Vertical component (grows downward in screen space). */
  readonly y: number;
};

/**
 * Creates a vector from its components.
 *
 * @public
 */
export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

/**
 * Component-wise sum `a + b`.
 *
 * @public
 */
export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/**
 * Component-wise difference `a - b`.
 *
 * @public
 */
export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * Multiplies both components by `k`.
 *
 * @public
 */
export function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

/**
 * Dot product `a · b`.
 *
 * @public
 */
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * 2D cross product (z component of the 3D cross product) `a.x * b.y - a.y * b.x`.
 *
 * @public
 */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * Euclidean length of `v`.
 *
 * @public
 */
export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/**
 * Euclidean distance between two points.
 *
 * @public
 */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Unit vector in the direction of `v`; the zero vector maps to the zero vector.
 *
 * @public
 */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/**
 * Linear interpolation: `a` at `t = 0`, `b` at `t = 1` (not clamped).
 *
 * @public
 */
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Rotates `v` about the origin by `radians` (clockwise on a y-down screen, counter-clockwise in math axes).
 *
 * @public
 */
export function rotate(v: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/**
 * True when both components differ by at most `eps`.
 *
 * @param eps - absolute tolerance per component (default `1e-9`)
 * @public
 */
export function equalsApprox(a: Vec2, b: Vec2, eps = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}
