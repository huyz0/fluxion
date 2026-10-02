// The screens navigator's model (FR-SCR-002, M8.12): where a dragged screen lands, and the records the add and
// duplicate commands are given. Pure; the panel (screens-tab.tsx) shows it.
import { type ReadView, screenRecordsToCopy } from '@fluxion/core';
import { screensInOrder } from '@fluxion/render';
import { keyBetween, type RecordId } from '@fluxion/schema';

/**
 * The screen a dragged screen should follow when dropped on `target` (above it, or below with `below`): undefined
 * for the first place; `null` when the drop changes nothing (on itself, or where it already is).
 */
export function dropAfter(order: readonly RecordId[], dragged: RecordId, target: RecordId, below: boolean): RecordId | undefined | null {
  if (dragged === target) return null;
  const others = order.filter((s) => s !== dragged);
  const at = others.indexOf(target) + (below ? 1 : 0);
  const after = others[at - 1];
  return order.indexOf(dragged) === at ? null : after;
}

/** The record of a new screen `id` after the last one. */
export function newScreen(view: ReadView, id: RecordId): { id: RecordId; type: 'screen'; index: string } {
  const last = screensInOrder(view, true).at(-1);
  const after = last === undefined ? null : String((view.get(last) as { index?: unknown }).index);
  const key = keyBetween(after, null);
  return { id, type: 'screen', index: key.ok ? key.value : 'a0' };
}

/** The arguments that duplicate `screen`: a new screen id, and a new id for each record it copies. */
export function duplicateArgs(view: ReadView, screen: RecordId, newId: () => RecordId): { id: RecordId; newId: RecordId; ids: Record<string, RecordId> } {
  return { id: screen, newId: newId(), ids: Object.fromEntries(screenRecordsToCopy(view, screen).map((r) => [r, newId()])) };
}
