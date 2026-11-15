// The path tool on the page (FR-SHP-011, ADR-0053): where a `core:path` shape's vertices and bezier handles are on the page, which
// one a press is on, which segment a press lies on, and the command an edited path makes. The path's reference box (`path.w ×
// path.h`) is scaled to the element's box and placed by its transform (turn and flips included). An edit writes `d` again with
// `w`, `h` and the transform refitted to the new bounds, so the points that did not move stay where they are on the page.
import { CORE_PATH_ID, type ReadView } from '@fluxion/core';
import { apply, type CubicSegment, elementMatrix, invert, type Mat2d, multiply, nearestPoint, pathBounds, scaling, type Vec2 } from '@fluxion/geometry';
import type { PathData, RecordId, ShapeElement } from '@fluxion/schema';
import { type EditPath, editCubics, handlePoint, type PathHandle, pathHandles, readEditPath, writeEditPath } from './path-edit-model.js';

/**
 * A `core:path` shape as the path tool edits it.
 *
 * @public
 */
export type PathTarget = {
  /** The element. */
  readonly element: ShapeElement & { readonly path: PathData };
  /** Its path, read. */
  readonly model: EditPath;
  /** The matrix from the path's reference box to the page. */
  readonly matrix: Mat2d;
};

/** The element's placement as the geometry takes it. */
const placement = (e: ShapeElement) => ({ ...e.transform, rot: e.transform.rot ?? 0 });

/**
 * The `core:path` shape `id` with its path read; undefined for anything else, or a path that does not read.
 *
 * @public
 */
export function pathTarget(view: ReadView, id: RecordId): PathTarget | undefined {
  const element = view.get(id) as ShapeElement | undefined;
  if (element?.type !== 'element' || element.kind !== 'shape' || element.defId !== CORE_PATH_ID || element.path === undefined) return undefined;
  const model = readEditPath(element.path.d);
  if (model === undefined) return undefined;
  const { w, h } = element.transform;
  const matrix = multiply(elementMatrix(placement(element)), scaling(w / element.path.w, h / element.path.h));
  return { element: element as PathTarget['element'], model, matrix };
}

/**
 * A handle of the path on the page.
 *
 * @public
 */
export type PlacedPathHandle = {
  /** Which handle. */
  readonly handle: PathHandle;
  /** Where it is, page units. */
  readonly page: Vec2;
  /** For a bezier handle, the vertex it belongs to, page units (the line drawn between them). */
  readonly vertex?: Vec2 | undefined;
};

/**
 * Every handle of `target` on the page: vertices first, then bezier handles with their vertices.
 *
 * @public
 */
export function placedPathHandles(target: PathTarget): readonly PlacedPathHandle[] {
  const { model, matrix } = target;
  return pathHandles(model).map((handle) => {
    const page = apply(matrix, handlePoint(model, handle) as Vec2);
    if (handle.kind === 'vertex') return { handle, page };
    const s = model[handle.sub] as EditPath[number];
    // a segment's first handle belongs to the vertex it leaves, its second to the vertex it reaches
    const at = handle.kind === 'c1' ? handle.index : (handle.index + 1) % s.points.length; // kind-switch-allow: a path handle's closed kind
    return { handle, page, vertex: apply(matrix, s.points[at] as Vec2) };
  });
}

/**
 * The handle of `handles` nearest page point `p` within `reach` page units, vertices before bezier handles at equal distance.
 *
 * @public
 */
export function pathHandleAt(handles: readonly PlacedPathHandle[], p: Vec2, reach: number): PlacedPathHandle | undefined {
  let best: PlacedPathHandle | undefined;
  let bestDistance = reach;
  for (const h of handles) {
    const d = Math.hypot(h.page.x - p.x, h.page.y - p.y);
    if (d < bestDistance || (d === bestDistance && best === undefined)) {
      best = h;
      bestDistance = d;
    }
  }
  return best;
}

const placed = (m: Mat2d, c: CubicSegment): CubicSegment => ({ p0: apply(m, c.p0), p1: apply(m, c.p1), p2: apply(m, c.p2), p3: apply(m, c.p3) });

/**
 * The segment of `target` page point `p` lies on, within `reach` page units, with the parameter of the nearest point on it.
 *
 * @public
 */
export function pathSegmentAt(target: PathTarget, p: Vec2, reach: number): { readonly sub: number; readonly index: number; readonly t: number } | undefined {
  const { model, matrix } = target;
  const segments = editCubics(model).map((c) => placed(matrix, c));
  const hit = segments.length === 0 ? null : nearestPoint({ segments, closed: false }, p);
  if (hit === null || hit.distance > reach) return undefined;
  let rest = hit.segment;
  for (const [sub, s] of model.entries()) {
    if (rest < s.segments.length) return { sub, index: rest, t: hit.t };
    rest -= s.segments.length;
  }
  return undefined;
}

/**
 * The page point `p` in `target`'s reference box; undefined when the placement cannot be inverted.
 *
 * @public
 */
export function toPathBox(target: PathTarget, p: Vec2): Vec2 | undefined {
  const back = invert(target.matrix);
  return back.ok ? apply(back.value, p) : undefined;
}

/**
 * The command that gives `target` the path `model`: `element.update` of `path` (`d` from the bounds' corner, `w` and `h` the
 * bounds) and of the transform's box, which moves and resizes with the bounds at the same scale, turn and flips, so every
 * point stays where `model` puts it on the page. Undefined for a path with no segment.
 *
 * @public
 */
export function pathEdit(target: PathTarget, model: EditPath): { readonly id: string; readonly args: unknown } | undefined {
  const bounds = pathBounds({ segments: editCubics(model), closed: false });
  if (bounds === null) return undefined;
  const { element } = target;
  const t = element.transform;
  const [sx, sy] = [t.w / element.path.w, t.h / element.path.h];
  // at least one page unit each way: a path flattened to a line keeps a box
  const [w, h] = [Math.max(bounds.w, 1 / sx), Math.max(bounds.h, 1 / sy)];
  const centre = apply(target.matrix, { x: bounds.x + w / 2, y: bounds.y + h / 2 });
  const [W, H] = [w * sx, h * sy];
  const transform = { ...t, x: centre.x - W / 2, y: centre.y - H / 2, w: W, h: H };
  const path = { ...element.path, d: writeEditPath(model, { x: bounds.x, y: bounds.y }), w, h };
  return { id: 'element.update', args: { id: element.id, fields: { path, transform } } };
}
