// The select tool's keyboard actions (FR-EDT-005, FR-SHP-008): nudge, select all and delete, run by keymap commands while the
// tool is idle; and what the canvas may pick (a selection lock keeps an element out of a click, a marquee and select-all).
import { lockedWithin } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { moved, starts } from './move.js';
import type { ToolCtx } from './tools.js';

/**
 * Nudge the selection by `d` page units, one undo step; false with nothing selected.
 *
 * @public
 */
export function nudgeSelection(ctx: ToolCtx, d: Vec2): boolean {
  const selected = ctx.session.selection.get();
  if (selected.length === 0) return false;
  // nothing of its own to move (a bound connector): the command refuses an empty list
  ctx.execute('element.updateMany', { updates: moved(starts(ctx.view, selected, 'position'), d) });
  return true;
}

/** Whether the canvas may pick `id`: neither it nor a group it sits in holds a selection lock (the layers panel still picks it, FR-SHP-008). */
export const pickable = (ctx: ToolCtx, id: RecordId): boolean => !lockedWithin(ctx.view, id, 'select');

/**
 * Select every selectable element of the canvas's screen.
 *
 * @public
 */
export function selectAll(ctx: ToolCtx): void {
  ctx.session.selection.set(ctx.allElements().filter((id) => pickable(ctx, id)));
}

/**
 * Delete the selection, one undo step, and select nothing; false with nothing selected.
 *
 * @public
 */
export function deleteSelection(ctx: ToolCtx): boolean {
  const ids = ctx.session.selection.get();
  if (ids.length === 0) return false;
  ctx.execute('element.delete', { ids });
  ctx.session.selection.set([]);
  return true;
}
