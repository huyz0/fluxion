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
export { intersectCubics, intersectPaths, intersectSegments, type LineSegment } from './intersections.js';
export { apply, determinant, identity, invert, type Mat2d, multiply, rotation, scaling, translate } from './mat2d.js';
export { type NearestPoint, nearestPoint } from './nearest.js';
export { type CubicSegment, derivativeAt, type Path, type PathCommand, pathBounds, pathFromCommands, pointAt, segmentBounds, splitAt } from './path.js';
export { createPathSampler, type PathSampler, type PathSamplerOptions } from './path-sampler.js';
export { type FillRule, pointInPath } from './point-in-path.js';
export type { GeometryError, GeometryErrorCode, Result } from './result.js';
export { createDynamicIndex, createStaticIndex, type DynamicSpatialIndex, type IndexedBox, type SpatialIndex } from './spatial-index.js';
export { add, cross, distance, dot, equalsApprox, length, lerp, normalize, rotate, scale, sub, type Vec2, vec2 } from './vec2.js';
