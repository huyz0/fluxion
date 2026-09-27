import fc from 'fast-check';
import { type Mat2d, multiply, rotation, scaling, translate } from '../mat2d.js';
import type { Vec2 } from '../vec2.js';

// Values are drawn on a 1e-3 grid, not with fc.double: fc.double spreads its samples over the
// representable doubles, so most draws are tiny and properties rarely see real geometry (M2.15 review F1, F2).
const grid = (min: number, max: number): fc.Arbitrary<number> => fc.integer({ min: min * 1000, max: max * 1000 }).map((n) => n / 1000);

/** Finite coordinate in [-100, 100] on a 1e-3 grid. */
export const coord: fc.Arbitrary<number> = grid(-100, 100);

/** Point with both coordinates in [-100, 100]. */
export const point: fc.Arbitrary<Vec2> = fc.record({ x: coord, y: coord });

/** Scale factor with magnitude in [0.1, 10], either sign. */
const factor: fc.Arbitrary<number> = fc.tuple(grid(0.1, 10), fc.boolean()).map(([s, negative]) => (negative ? -s : s));

/**
 * A well-conditioned affine matrix: translate(t) · rotation(θ) · shear(k) · scaling(sx, sy), with
 * θ in whole or quarter degrees, |sx|, |sy| in [0.1, 10], shear k in [-2, 2] and translation in
 * [-1000, 1000]; its condition number stays below about 10⁴.
 */
export const matrix: fc.Arbitrary<Mat2d> = fc
  .record({ tx: grid(-1000, 1000), ty: grid(-1000, 1000), quarterDegrees: fc.integer({ min: -1440, max: 1440 }), k: grid(-2, 2), sx: factor, sy: factor })
  .map(({ tx, ty, quarterDegrees, k, sx, sy }) =>
    multiply(translate(tx, ty), multiply(rotation(((quarterDegrees / 4) * Math.PI) / 180), multiply([1, 0, k, 1, 0, 0], scaling(sx, sy)))),
  );
