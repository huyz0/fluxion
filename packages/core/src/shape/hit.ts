// Hit-testing and perimeter projection over an evaluated outline (FR-SHP-005, ADR-0016 item 2): the
// one path every consumer reads. A closed outline has an inside (nonzero rule); an open one is only
// its stroke. Projection casts a ray and lands exactly on the outline.
import { type Box, intersectPaths, lerp, type NearestPoint, nearestPoint, type Path, pathBounds, pointInPath, type Vec2 } from '@fluxion/geometry';

/**
 * Whether `p` (in the shape's own box) hits the outline `path`: inside it when it is closed, or within
 * `tolerance` of it (half the stroke width plus a pick margin; open outlines have only this).
 *
 * @public
 */
export function hitTestShape(path: Path, p: Vec2, tolerance = 0): boolean {
  if (path.closed && pointInPath(path, p, 'nonzero')) return true;
  return outlineDistance(path, p) <= tolerance;
}

/**
 * The distance from `p` to the nearest point of the outline `path` (infinite for an empty path).
 *
 * @public
 */
export function outlineDistance(path: Path, p: Vec2): number {
  return nearestPoint(path, p)?.distance ?? Number.POSITIVE_INFINITY;
}

/**
 * Where the ray from `from` along `dir` last meets the outline `path`: the outermost crossing, or the
 * far end of an edge the ray runs along (a floating anchor projects from a shape's centre towards the
 * other end). The nearest point of the outline when the ray misses it or `dir` is zero; null for an
 * empty path. The point lies on the outline: a crossing is snapped to its nearest outline point.
 *
 * @public
 */
export function projectToOutline(path: Path, from: Vec2, dir: Vec2): Vec2 | null {
  const nearest = nearestPoint(path, from);
  const length = Math.hypot(dir.x, dir.y);
  // tzap disable next-line ConditionalExpression,EqualityOperator: a zero or NaN direction makes a NaN ray, which crosses nothing: the nearest point either way; the guard states it
  if (nearest === null || !(length > 0)) return nearest?.point ?? null;
  // a path with a nearest point has segments, so it has bounds
  const box = pathBounds(path) as Box;
  // far enough to leave the outline's box from anywhere the ray starts
  const reach = Math.hypot(Math.abs(from.x - box.x) + box.w, Math.abs(from.y - box.y) + box.h) + 1;
  const to = { x: from.x + (dir.x / length) * reach, y: from.y + (dir.y / length) * reach };
  // tzap disable next-line ArithmeticOperator,BooleanLiteral: any control points on the ray draw the same line, and intersection ignores closed
  const ray: Path = { segments: [{ p0: from, p1: lerp(from, to, 1 / 3), p2: lerp(from, to, 2 / 3), p3: to }], closed: false };
  // how far along the ray, up to a constant: only compared
  const along = (q: Vec2) => q.x * dir.x + q.y * dir.y;
  // a ray along a straight edge overlaps it without crossing it: the outline's joints on the ray, ahead
  // of its start, count as well (M5.12 review F1)
  // tzap disable next-line ArithmeticOperator: a rounding tolerance; its exact scale is not observable
  const slack = 1e-9 * length * reach;
  const offRay = (q: Vec2) => Math.abs((q.x - from.x) * dir.y - (q.y - from.y) * dir.x);
  // tzap disable next-line EqualityOperator: an exact rounding threshold is not observable
  const onRay = (q: Vec2) => offRay(q) <= slack && along(q) > along(from);
  const joints = [path.segments[0]?.p0 as Vec2, ...path.segments.map((seg) => seg.p3)].filter(onRay);
  // tzap disable next-line EqualityOperator: two points equally far along are the same point
  const last = [...intersectPaths(ray, path), ...joints].reduce<Vec2 | null>((best, q) => (best === null || along(q) > along(best) ? q : best), null);
  return last === null ? nearest.point : (nearestPoint(path, last) as NearestPoint).point;
}
