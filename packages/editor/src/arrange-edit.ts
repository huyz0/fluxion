// Arranging in the editor (FR-ARR-002, FR-ARR-003, FR-ARR-004, M8.26): the selection aligned, distributed and put
// forward or back, each one core command and so one undo step. Pure over the tool context; the keymap, the palette and
// the menus call these through the editor commands below.
import type { ToolCtx } from './tools.js';

/** The align modes, with the words people read. */
export const ALIGN_MODES = [
  ['left', 'Align left'],
  ['center', 'Align centre'],
  ['right', 'Align right'],
  ['top', 'Align top'],
  ['middle', 'Align middle'],
  ['bottom', 'Align bottom'],
] as const;

/** The distribute axes. */
export const DISTRIBUTE_AXES = [
  ['horizontal', 'Distribute horizontally'],
  ['vertical', 'Distribute vertically'],
] as const;

/** The order moves. */
export const ORDER_MOVES = [
  ['front', 'Bring to front'],
  ['forward', 'Bring forward'],
  ['backward', 'Send backward'],
  ['back', 'Send to back'],
] as const;

/**
 * Align the selection: several elements to their own bounds, one to the screen. False with nothing selected or when the
 * document refuses (an infinite screen has no edges, elements on two screens).
 *
 * @public
 */
export function alignSelection(ctx: ToolCtx, mode: (typeof ALIGN_MODES)[number][0]): boolean {
  const ids = ctx.session.selection.get();
  return ids.length > 0 && ctx.execute('element.align', { ids, mode, to: ids.length > 1 ? 'selection' : 'screen' }).ok;
}

/**
 * Space the selection evenly along an axis (equal gaps between three or more). False when fewer are selected or the
 * document refuses.
 *
 * @public
 */
export function distributeSelection(ctx: ToolCtx, axis: (typeof DISTRIBUTE_AXES)[number][0]): boolean {
  const ids = ctx.session.selection.get();
  return ids.length >= 3 && ctx.execute('element.distribute', { ids, axis, by: 'gaps' }).ok;
}

/**
 * Move the selection in the stacking order. False with nothing selected or when the document refuses.
 *
 * @public
 */
export function orderSelection(ctx: ToolCtx, to: (typeof ORDER_MOVES)[number][0]): boolean {
  const ids = ctx.session.selection.get();
  return ids.length > 0 && ctx.execute('element.zOrder', { ids, to }).ok;
}
