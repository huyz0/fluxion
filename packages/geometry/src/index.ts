// Public entry of @fluxion/geometry; the package comment is the dts banner in tsdown.config.ts.
/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

export {
  type Box,
  boxCenter,
  boxContains,
  boxContainsBox,
  boxCorners,
  boxFromPoints,
  boxInflate,
  boxIntersection,
  boxIntersects,
  boxUnion,
  transformBox,
} from './box.js';
export { type ElementTransform, elementBounds, elementCorners, elementMatrix } from './element-transform.js';
export { apply, determinant, identity, invert, type Mat2d, multiply, rotation, scaling, translate } from './mat2d.js';
export type { GeometryError, GeometryErrorCode, Result } from './result.js';
export { add, cross, distance, dot, equalsApprox, length, lerp, normalize, rotate, scale, sub, type Vec2, vec2 } from './vec2.js';
