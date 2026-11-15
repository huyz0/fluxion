// The inspector's icon slots (FR-SHP-007, ADR-0054, M19.17): a selected shape's slots, what fills each, and the one
// `element.update` that fills, refills or empties one. Pure: slot-section.tsx shows the rows.
import type { ReadView } from '@fluxion/core';
import type { RecordId, ShapeElement } from '@fluxion/schema';
import type { InspectorCommand } from './inspector-model.js';
import type { ShapeDefs } from './param-handles.js';

/** One icon slot: its name, and the shape definition or image asset filling it, if any. */
export type SlotRow = { readonly name: string; readonly defId?: string; readonly assetId?: string };

type Fill = { readonly defId: string } | { readonly assetId: string };

/** The shape `id` when it is one, with its definition. */
function shapeOf(view: ReadView, id: RecordId, defs: ShapeDefs | undefined) {
  const e = view.get(id) as ShapeElement | undefined;
  if (e?.type !== 'element' || e.kind !== 'shape') return undefined;
  const def = defs?.get(e.defId);
  return def === undefined ? undefined : { e, def };
}

/** The icon slots of shape `id`'s definition, in its order, each with its fill; undefined when it has none. */
export function slotRows(view: ReadView, id: RecordId, defs: ShapeDefs | undefined): readonly SlotRow[] | undefined {
  const found = shapeOf(view, id, defs);
  const slots = found?.def.iconSlots ?? [];
  if (found === undefined || slots.length === 0) return undefined;
  const icons = found.e.icons ?? {};
  return slots.map((s) => ({ name: s.name, ...icons[s.name] }));
}

/** The command filling slot `name` of shape `id` with the definition `defId` (blank empties it; the field goes with the last). */
export function fillSlot(store: ReadView, id: RecordId, name: string, defId: string): InspectorCommand | undefined {
  const e = store.get(id) as ShapeElement | undefined;
  if (e?.type !== 'element' || e.kind !== 'shape') return undefined;
  const { [name]: _, ...rest } = (e.icons ?? {}) as { readonly [slot: string]: Fill };
  const icons: { readonly [slot: string]: Fill } = defId === '' ? rest : { ...rest, [name]: { defId } };
  return { id: 'element.update', args: { id, fields: { icons: Object.keys(icons).length === 0 ? undefined : icons } } };
}
