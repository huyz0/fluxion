// An operand's placement for the boolean operations (ADR-0053 step 1, M19 cp1 F4): `elementMatrix` with the turn's sine and cosine
// computed by series on the reduced angle rather than `Math.sin`/`Math.cos`, whose last bit is not specified and differs between
// engines; products and sums only, so a turned operand gives the same bytes in Node, Chromium, Firefox and WebKit. Pure.
import type { ElementTransform } from '../element-transform.js';
import { type Mat2d, multiply, scaling, translate } from '../mat2d.js';

/** π / 180 as a double. */
const RADIANS_PER_DEGREE = 0.017453292519943295;

/** sin and cos of `x` radians, |x| ≤ π/4, by their Taylor series to the 17th and 16th power (error below 1e-17). */
function series(x: number): readonly [number, number] {
  const x2 = x * x;
  let [s, c, ts, tc] = [x, 1, x, 1];
  for (let k = 1; k <= 8; k++) {
    ts *= -x2 / (2 * k * (2 * k + 1));
    tc *= -x2 / ((2 * k - 1) * (2 * k));
    s += ts;
    c += tc;
  }
  return [s, c];
}

/** The sine and cosine of `deg` degrees: exact at quarter turns, by series on the angle reduced to ±45° otherwise. */
export function sinCosDegrees(deg: number): readonly [number, number] {
  const turns = Math.round(deg / 90);
  const rest = deg - 90 * turns;
  const [s, c] = rest === 0 ? [0, 1] : series(rest * RADIANS_PER_DEGREE);
  const quarter = ((turns % 4) + 4) % 4;
  const byQuarter: readonly (readonly [number, number])[] = [
    [s, c],
    [c, -s],
    [-s, -c],
    [-c, s],
  ];
  return byQuarter[quarter] as readonly [number, number];
}

/**
 * The matrix placing an element's own box at `t` (flips, then the turn about the centre, then the move), the same everywhere.
 *
 * @public
 */
export function booleanPlacement(t: ElementTransform): Mat2d {
  const [cx, cy] = [t.w / 2, t.h / 2];
  const [s, c] = sinCosDegrees(t.rot);
  const turn: Mat2d = [c, s, -s, c, 0, 0];
  const flip = scaling(t.flipX === true ? -1 : 1, t.flipY === true ? -1 : 1);
  return multiply(translate(t.x + cx, t.y + cy), multiply(multiply(turn, flip), translate(-cx, -cy)));
}
