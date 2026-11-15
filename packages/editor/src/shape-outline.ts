// What a shape is hit on (ADR-0053, M19.41): a `core:path` shape's own subpaths under its fill rule, else its definition's outline,
// and whether a marquee box touches any of them. Split from hit-test.ts.
import { evaluateOutline, hitTestShape, ownPathOf, type ShapeDef } from '@fluxion/core';
import { apply, type Box, type Mat2d, type Path, pointInPaths, type Vec2 } from '@fluxion/geometry';
import type { ElementRecord, Transform } from '@fluxion/schema';
import { boxTouches } from './box-touch.js';

/** What a shape is hit on: the outline bounds and anchors measure, every other subpath drawn, and whether a point is inside. */
export type ShapeOutline = { readonly path: Path; readonly rings: readonly Path[]; readonly within: (l: Vec2) => boolean };

/**
 * The outline `element` of definition `def` is hit on, its other stroked subpaths (a path shape's holes and islands) and the test
 * of its inside: a path shape's own outline, its subpaths filled under its rule (a hole is not inside, ADR-0053), else the
 * definition's; undefined when neither evaluates.
 */
export function shapeOutline(element: ElementRecord & { readonly transform: Transform }, def: ShapeDef): ShapeOutline | undefined {
  const size = { w: element.transform.w, h: element.transform.h };
  const own = ownPathOf({ defId: def.id, path: (element as { path?: never }).path }, size);
  if (own !== undefined)
    return { path: own.outline, rings: own.paths.filter((p) => p !== own.outline), within: (l) => pointInPaths(own.paths, l, own.fillRule) };
  const outlined = evaluateOutline(def, size, (element as { params?: Record<string, unknown> }).params);
  if (!outlined.ok) return undefined;
  const path = outlined.value.path;
  // an open outline has no inside
  return { path, rings: [], within: (l) => path.closed && hitTestShape(path, l, 0) };
}

/** Whether page box `box` crosses or holds a part of any of `paths` (in the frame `inv` maps into), or lies where `inside` holds. */
export function touchesAny(paths: readonly Path[], inside: ((l: Vec2) => boolean) | undefined, box: Box, inv: Mat2d): boolean {
  if (inside?.(apply(inv, { x: box.x, y: box.y })) === true) return true;
  return paths.some((p) => boxTouches(p, false, box, inv));
}
