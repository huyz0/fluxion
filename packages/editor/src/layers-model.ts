// What the layers panel lists and does (FR-ARR-008, M19.14): the shown screen's elements as a tree, front first and members under
// their group or frame; where a dragged row lands among its siblings; and what the lock toggle sets.
import type { ReadView } from '@fluxion/core';
import { compareKeys, type RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import './i18n.js';

/** One row of the layers panel. */
export type LayerRow = {
  readonly id: RecordId;
  readonly label: string;
  /** 0 for the screen's top level, one more per enclosing group or frame. */
  readonly depth: number;
  readonly parentId: RecordId | undefined;
  readonly hidden: boolean;
  readonly locked: boolean;
};

type Layered = {
  readonly kind?: string;
  readonly name?: string;
  readonly index?: string;
  readonly parentId?: RecordId;
  readonly hidden?: boolean;
  readonly locks?: Record<string, unknown>;
  readonly semantic?: { readonly label?: string };
};

/** The locks the lock toggle sets together: the element stays where it is and the canvas does not pick it (the panel still does). */
export const LAYER_LOCKS = ['position', 'size', 'rotation', 'select'] as const;

/** Whether every lock the toggle sets is on. */
export const isLocked = (locks: Record<string, unknown> | undefined): boolean => LAYER_LOCKS.every((k) => locks?.[k] === true);

/** The `locks` that turn the toggle's locks on or off, keeping the element's other locks; undefined when none is left. */
export function toggledLocks(locks: Record<string, unknown> | undefined, lock: boolean): Record<string, unknown> | undefined {
  const rest = Object.fromEntries(Object.entries(locks ?? {}).filter(([k]) => !(LAYER_LOCKS as readonly string[]).includes(k)));
  const out = lock ? { ...rest, ...Object.fromEntries(LAYER_LOCKS.map((k) => [k, true])) } : rest;
  return Object.keys(out).length === 0 ? undefined : out;
}

/** The words for an element of `kind` without a name. */
const KIND_LABELS = new Map<string, () => string>([
  ['shape', () => t`Shape`],
  ['text', () => t`Text`],
  ['connector', () => t`Connector`],
  ['group', () => t`Group`],
  ['frame', () => t`Frame`],
  ['image', () => t`Image`],
  ['path', () => t`Path`],
  ['table', () => t`Table`],
]);

/** A row's words: the element's label, else its name, else its kind. */
const labelOf = (r: Layered): string => r.semantic?.label?.trim() || r.name?.trim() || (KIND_LABELS.get(r.kind ?? '')?.() ?? r.kind ?? t`Element`);

/** The rows of `screenId`: each sibling list front first (index, then id, reversed), members right under their parent. */
export function layerRows(view: ReadView, screenId: RecordId): LayerRow[] {
  const get = (id: RecordId) => (view.get(id) ?? {}) as Layered;
  const front = (a: RecordId, b: RecordId) => compareKeys(String(get(b).index ?? ''), String(get(a).index ?? '')) || (a < b ? 1 : -1);
  const rows: LayerRow[] = [];
  const walk = (ids: readonly RecordId[], depth: number) => {
    for (const id of [...ids].sort(front)) {
      const r = get(id);
      rows.push({ id, label: labelOf(r), depth, parentId: r.parentId, hidden: r.hidden === true, locked: isLocked(r.locks) });
      walk(view.members('byParent', id), depth + 1);
    }
  };
  walk(
    view.members('byScreen', screenId).filter((id) => get(id).parentId === undefined),
    0,
  );
  return rows;
}

/**
 * The `element.reorder` arguments of dropping `dragged` on `target` (on its upper half: in front of it; lower half: behind it), or
 * null when the drop changes nothing or crosses into another sibling list (the panel reorders; it does not reparent).
 */
export function layerDrop(
  rows: readonly LayerRow[],
  dragged: RecordId,
  target: RecordId,
  upper: boolean,
): { readonly id: RecordId; readonly after?: RecordId } | null {
  const [from, to] = [rows.find((r) => r.id === dragged), rows.find((r) => r.id === target)];
  if (from === undefined || to === undefined || dragged === target || from.parentId !== to.parentId) return null;
  // the sibling list back to front, without the dragged row
  const list = rows
    .filter((r) => r.parentId === from.parentId && r.depth === from.depth && r.id !== dragged)
    .map((r) => r.id)
    .reverse();
  const at = list.indexOf(target);
  const after = upper ? target : list[at - 1];
  const now = rows
    .filter((r) => r.parentId === from.parentId && r.depth === from.depth)
    .map((r) => r.id)
    .reverse();
  if (now[now.indexOf(dragged) - 1] === after) return null;
  return after === undefined ? { id: dragged } : { id: dragged, after };
}
