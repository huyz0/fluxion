// Which elements have text the editor opens (FR-TXT-003, M7.12) and the one write that closes the edit.
// A shape's text and a `text` element's are the same rich text; the editor opens both (a `text` element
// that was pasted, imported or written by hand draws through TextView and edits in the same editor).
import { namedBoxes, type ReadView, type ShapeDef } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { ElementRecord, RecordId, ShapeElement, TextElement } from '@fluxion/schema';
import type { Session } from './session.js';

/** The element kinds whose text the editor edits (a registry, not a chain of tests: FR-EXT-001). */
const TEXTED: ReadonlySet<unknown> = new Set(['shape', 'text']);

/** The element `id`, when it is one whose text the editor can edit. */
export function textElement(view: ReadView, id: RecordId): ShapeElement | TextElement | undefined {
  const record = view.get(id) as ElementRecord | undefined;
  return record?.type === 'element' && TEXTED.has(record.kind) ? (record as ShapeElement | TextElement) : undefined;
}

/** Whether the record `id` is an element whose text the editor can edit. */
export const hasText = (view: ReadView, id: RecordId): boolean => textElement(view, id) !== undefined;

/** Open the text of the one selected element for editing; false when the selection is not exactly one such element. */
export function editSelectedText(session: Session, view: ReadView): boolean {
  const [only, ...rest] = session.selection.get();
  if (only === undefined || rest.length > 0 || !hasText(view, only)) return false;
  session.editingRegion.set(undefined);
  session.editing.set(only);
  return true;
}

/**
 * The text region of shape `element` under page point `at`, when it is a region after the first (FR-SHP-007): the one a
 * double-click there edits. The point is taken into the shape's own frame (unturned, unflipped) first.
 */
export function regionAt(element: ShapeElement | TextElement, def: ShapeDef | undefined, at: Vec2): string | undefined {
  if (element.kind !== 'shape' || def === undefined) return undefined;
  const t = element.transform;
  const a = (-(t.rot ?? 0) * Math.PI) / 180;
  const dx = at.x - (t.x + t.w / 2);
  const dy = at.y - (t.y + t.h / 2);
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const x = (t.flipX === true ? -lx : lx) + t.w / 2;
  const y = (t.flipY === true ? -ly : ly) + t.h / 2;
  const regions = namedBoxes(def, { w: t.w, h: t.h }, 'textRegions', element.params);
  const hit = regions.find((r, i) => i > 0 && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  return hit?.name;
}

/**
 * The region Tab (Shift+Tab, `back`) moves the open editor to from `region` (undefined: the first) of a shape whose definition
 * is `def` (FR-SHP-007): the next (previous) region's name, undefined again for the first, or false when there is none that way.
 */
export function regionAfter(def: ShapeDef | undefined, region: string | undefined, back: boolean): string | undefined | false {
  const names = (def?.textRegions ?? []).map((r) => r.name);
  const at = region === undefined ? 0 : names.indexOf(region);
  const to = at + (back ? -1 : 1);
  if (at < 0 || to < 0 || to >= names.length) return false;
  return to === 0 ? undefined : names[to];
}
