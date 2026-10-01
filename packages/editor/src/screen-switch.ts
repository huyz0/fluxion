// Which screen the canvas shows (FR-EDT-006, M7.6): `session.screen` names it; a name that is not a
// screen of the document any more (deleted, an undo) falls back to the first. Pure.
import type { ReadView } from '@fluxion/core';
import { screensInOrder } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';

/**
 * The screen to show: `wanted` if it is a screen of `view`, else the first one (hidden screens count,
 * they are edited too); undefined when the document has none.
 *
 * @public
 */
export function shownScreen(view: ReadView, wanted: RecordId | undefined): RecordId | undefined {
  const all = screensInOrder(view, true);
  return wanted !== undefined && all.includes(wanted) ? wanted : all[0];
}

/**
 * A screen's label in lists: its name, or `Screen <n>` (1-based position) when it has none or a blank one.
 *
 * @public
 */
export const screenLabel = (name: string | undefined, index: number): string => (name === undefined || name.trim() === '' ? `Screen ${index + 1}` : name);
