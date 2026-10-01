// Parametric handles in the editor (FR-SHP-003, M7.17): where the handles of the selected shape are on the page,
// which one a press is on, and the param change a drag to a page point makes. The maths of a handle (its place
// in the box, the param value nearest a point) is core's `shapeHandles` / `handleValue`; this maps the box to the
// page through the element's placement (turn and flips included).
import type { ReadView } from '@fluxion/core';
import { handleValue, type ShapeDef, shapeHandles } from '@fluxion/core';
import { apply, elementMatrix, invert, type Vec2 } from '@fluxion/geometry';
import type { RecordId, ShapeElement } from '@fluxion/schema';

/**
 * Where shape definitions are looked up (the render registries').
 *
 * @public
 */
export type ShapeDefs = {
  /** The definition `id`, if registered. */
  get(id: string): ShapeDef | undefined;
};

/**
 * A handle of a shape element, on the page.
 *
 * @public
 */
export type PlacedParamHandle = {
  /** The element. */
  readonly element: RecordId;
  /** The handle's index in the definition's `handles`. */
  readonly index: number;
  /** The param it edits. */
  readonly param: string;
  /** Where it is, page units. */
  readonly page: Vec2;
};

/**
 * The command a handle drag runs.
 *
 * @public
 */
export type ParamCommand = {
  /** The command id. */
  readonly id: string;
  /** Its arguments. */
  readonly args: unknown;
};

/** The shape element `id` with its definition, when it is one that has handles. */
function shapeOf(view: ReadView, defs: ShapeDefs, id: RecordId): { readonly element: ShapeElement; readonly def: ShapeDef } | undefined {
  const element = view.get(id) as ShapeElement | undefined;
  if (element?.type !== 'element' || element.kind !== 'shape') return undefined;
  const def = defs.get(element.defId);
  return def?.handles === undefined || def.handles.length === 0 ? undefined : { element, def };
}

/** The placement of an element as the geometry takes it (no turn when it has none). */
const placement = (e: ShapeElement) => ({ ...e.transform, rot: e.transform.rot ?? 0 });

/**
 * The handles of the shape `id` on the page, in definition order; none for an element that is no shape, has no
 * definition, or none with handles.
 *
 * @public
 */
export function paramHandlesOf(view: ReadView, defs: ShapeDefs, id: RecordId): readonly PlacedParamHandle[] {
  const shape = shapeOf(view, defs, id);
  if (shape === undefined) return [];
  const m = elementMatrix(placement(shape.element));
  const size = { w: shape.element.transform.w, h: shape.element.transform.h };
  return shapeHandles({ def: shape.def, size, params: shape.element.params }).map((h) => ({
    element: id,
    index: h.index,
    param: h.param,
    page: apply(m, h.at),
  }));
}

/**
 * The handle of `handles` nearest page point `p` within `reach` page units, if any.
 *
 * @public
 */
export function paramHandleAt(handles: readonly PlacedParamHandle[], p: Vec2, reach: number): PlacedParamHandle | undefined {
  let best: PlacedParamHandle | undefined;
  let bestDistance = reach;
  for (const h of handles) {
    const d = Math.hypot(h.page.x - p.x, h.page.y - p.y);
    if (d <= bestDistance) {
      best = h;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * The command that drags handle `index` of the shape `id` to page point `p`: `element.update` setting the param
 * the handle edits to the value that puts the handle nearest `p`, the element's other params kept. Undefined when
 * the handle is not there or no value can be found.
 *
 * @public
 */
export function paramEdit(view: ReadView, defs: ShapeDefs, target: { readonly id: RecordId; readonly index: number }, p: Vec2): ParamCommand | undefined {
  const shape = shapeOf(view, defs, target.id);
  const handle = shape?.def.handles?.[target.index];
  if (shape === undefined || handle === undefined) return undefined;
  const back = invert(elementMatrix(placement(shape.element)));
  if (!back.ok) return undefined;
  const size = { w: shape.element.transform.w, h: shape.element.transform.h };
  const value = handleValue({ def: shape.def, size, params: shape.element.params }, target.index, apply(back.value, p));
  if (value === undefined) return undefined;
  return { id: 'element.update', args: { id: target.id, fields: { params: { ...shape.element.params, [handle.param]: value } } } };
}
