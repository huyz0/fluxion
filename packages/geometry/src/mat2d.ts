import { err, ok, type Result } from './result.js';
import type { Vec2 } from './vec2.js';

/**
 * A 2D affine matrix `[a, b, c, d, e, f]` in the SVG/Canvas convention:
 * `x' = a*x + c*y + e`, `y' = b*x + d*y + f`.
 *
 * @public
 */
export type Mat2d = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

/** Determinant magnitude below which a matrix is treated as singular. */
const SINGULAR_EPS = 1e-12;

/**
 * The identity matrix.
 *
 * @public
 */
export function identity(): Mat2d {
  return [1, 0, 0, 1, 0, 0];
}

/**
 * Translation by `(tx, ty)`.
 *
 * @public
 */
export function translate(tx: number, ty: number): Mat2d {
  return [1, 0, 0, 1, tx, ty];
}

/**
 * Scale about the origin by `sx` horizontally and `sy` vertically (`sy` defaults to `sx`).
 *
 * @public
 */
export function scaling(sx: number, sy: number = sx): Mat2d {
  return [sx, 0, 0, sy, 0, 0];
}

/**
 * Rotation about the origin by `radians` (clockwise on a y-down screen).
 *
 * @public
 */
export function rotation(radians: number): Mat2d {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

/**
 * Composes two matrices: the result applies `n` first, then `m` (i.e. the product `m · n`).
 * For example `multiply(translate(10, 0), scaling(2))` scales, then translates.
 *
 * @public
 */
export function multiply(m: Mat2d, n: Mat2d): Mat2d {
  const [ma, mb, mc, md, me, mf] = m;
  const [na, nb, nc, nd, ne, nf] = n;
  return [ma * na + mc * nb, mb * na + md * nb, ma * nc + mc * nd, mb * nc + md * nd, ma * ne + mc * nf + me, mb * ne + md * nf + mf];
}

/**
 * Determinant of the linear part, `a*d - b*c`.
 *
 * @public
 */
export function determinant(m: Mat2d): number {
  return m[0] * m[3] - m[1] * m[2];
}

/**
 * Inverse matrix, or error `'MATRIX_SINGULAR'` when the determinant is not finite or
 * `|det| < 1e-12 · s²`, where `s` is the largest linear entry magnitude (at least 1): the threshold
 * is relative to the matrix scale, since `det` is quadratic in the entries.
 *
 * @public
 */
export function invert(m: Mat2d): Result<Mat2d> {
  const det = determinant(m);
  // relative to the matrix scale: |det| is quadratic in the entries (M2.15 review F3)
  const scale = Math.max(1, Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2]), Math.abs(m[3]));
  if (!Number.isFinite(det) || Math.abs(det) < SINGULAR_EPS * scale * scale) {
    return err({ code: 'MATRIX_SINGULAR', message: `Matrix is not invertible (determinant ${det}).` });
  }
  const [a, b, c, d, e, f] = m;
  return ok([d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]);
}

/**
 * Transforms point `p` by `m`.
 *
 * @public
 */
export function apply(m: Mat2d, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
