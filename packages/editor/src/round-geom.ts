// The precision a gesture writes (FR-EDT-022): a pointer-to-page conversion carries float noise (109.99999999999997), and the Source view prints
// whatever the document holds, so positions, sizes and turns a gesture writes are rounded here, once, at the write. Existing values are not touched.

/** The decimals a gesture writes (2: a hundredth of a unit is far below a pixel at any zoom the camera allows). */
export const GEOM_DECIMALS = 2;

/**
 * `n` rounded to `decimals` places, halves away from zero, and never `-0` (which prints as `-0` and is not equal to `0` under `Object.is`).
 *
 * @param n - a position, size or angle
 * @param decimals - the places to keep (2 by default)
 * @returns the rounded number
 */
export function roundGeom(n: number, decimals: number = GEOM_DECIMALS): number {
  const f = 10 ** decimals;
  const r = (Math.sign(n) * Math.round(Math.abs(n) * f)) / f;
  return r === 0 ? 0 : r;
}
