// The inspector's anchors (FR-ANC-006, FR-ANC-005): the anchors a selected shape offers, by name, its definition's and the default
// ones as labels and its own (custom) ones with their place; and the commands that add, move and remove a custom anchor. Each is one
// `element.updateMany` of the shape's `anchors`, so one undo step.
import type { ReadView } from '@fluxion/core';
import { DEFAULT_ANCHORS } from '@fluxion/routing';
import type { AnchorDef, RecordId, ShapeElement } from '@fluxion/schema';
import type { InspectorCommand } from './inspector-model.js';
import type { ShapeDefs } from './param-handles.js';

/**
 * One anchor of a shape, as the inspector lists it.
 */
export type AnchorRow = {
  /** The anchor's name: its label. */
  readonly name: string;
  /** Whether the shape itself declares it (a custom anchor: it can be removed, and moved when fixed). */
  readonly custom: boolean;
  /** A custom fixed anchor's place across the shape's box, 0 (left) to 1 (right); absent for every other anchor. */
  readonly x?: number | undefined;
  /** A custom fixed anchor's place down the shape's box, 0 (top) to 1 (bottom). */
  readonly y?: number | undefined;
};

/** Whether `a` is a point at a place of the box (its `x` and `y`): a side, perimeter or centre anchor places itself otherwise. */
const fixed = (a: AnchorDef): boolean => a.kind === undefined || a.kind === 'fixed'; // kind-switch-allow: ADR-0043's closed union

/** The shape `id` names, if it is one. */
function shapeOf(view: ReadView, id: RecordId): ShapeElement | undefined {
  const r = view.get(id) as ShapeElement | undefined;
  return r?.type === 'element' && r.kind === 'shape' ? r : undefined;
}

/**
 * The anchors of the shape `id`, one per name: its own first, then its definition's, then the defaults. Undefined for anything but a
 * shape.
 */
export function anchorRows(view: ReadView, id: RecordId, defs: ShapeDefs | undefined): readonly AnchorRow[] | undefined {
  const shape = shapeOf(view, id);
  if (shape === undefined) return undefined;
  const own = shape.anchors ?? [];
  const seen = new Set<string>();
  const rows: AnchorRow[] = [];
  for (const [a, custom] of [
    ...own.map((a) => [a, true] as const),
    ...(defs?.get(shape.defId)?.anchors ?? []).map((a) => [a, false] as const),
    ...DEFAULT_ANCHORS.map((a) => [a, false] as const),
  ]) {
    if (seen.has(a.name)) continue;
    seen.add(a.name);
    rows.push(custom && fixed(a) ? { name: a.name, custom, x: a.x, y: a.y } : { name: a.name, custom });
  }
  return rows;
}

/** The command that sets the shape's own anchors to `anchors` (none: the field goes). */
const setAnchors = (id: RecordId, anchors: readonly AnchorDef[]): InspectorCommand => ({
  id: 'element.updateMany',
  args: { updates: [{ id, fields: { anchors: anchors.length === 0 ? undefined : anchors } }] },
});

const unit = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The command that adds a custom anchor to the shape `id`, on its right side a quarter down, named `a1`, `a2`... (the first name no anchor
 * of the shape has), and that name. Undefined for anything but a shape.
 */
export function addAnchor(
  view: ReadView,
  id: RecordId,
  defs: ShapeDefs | undefined,
): { readonly command: InspectorCommand; readonly name: string } | undefined {
  const shape = shapeOf(view, id);
  const rows = anchorRows(view, id, defs);
  if (shape === undefined || rows === undefined) return undefined;
  const taken = new Set(rows.map((r) => r.name));
  let n = 1;
  while (taken.has(`a${n}`)) n += 1;
  const name = `a${n}`;
  return { command: setAnchors(id, [...(shape.anchors ?? []), { name, x: 1, y: 0.25 }]), name };
}

/**
 * The command that moves the custom fixed anchor `name` of the shape `id` to `to` (fractions of its box, kept within 0..1; an absent
 * one stays). Undefined when the shape has no such fixed anchor of its own, or when the place does not change.
 */
export function moveAnchor(view: ReadView, id: RecordId, name: string, to: { readonly x?: number; readonly y?: number }): InspectorCommand | undefined {
  const own = shapeOf(view, id)?.anchors ?? [];
  const anchor = own.find((a) => a.name === name);
  if (anchor === undefined || !fixed(anchor)) return undefined;
  const moved = { ...anchor, ...(to.x === undefined ? {} : { x: unit(to.x) }), ...(to.y === undefined ? {} : { y: unit(to.y) }) };
  if (moved.x === anchor.x && moved.y === anchor.y) return undefined;
  return setAnchors(
    id,
    own.map((a) => (a === anchor ? moved : a)),
  );
}

/**
 * The command that removes the custom anchor `name` of the shape `id`. A connector end bound there then floats on the outline, as an
 * anchor name that resolves to nothing does in routing. Undefined when the shape has no such anchor of its own.
 */
export function removeAnchor(view: ReadView, id: RecordId, name: string): InspectorCommand | undefined {
  const own = shapeOf(view, id)?.anchors ?? [];
  if (!own.some((a) => a.name === name)) return undefined;
  return setAnchors(
    id,
    own.filter((a) => a.name !== name),
  );
}
