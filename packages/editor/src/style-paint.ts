// Copy style and Paste style (FR-ARR-007, M19.40): Copy style remembers the one selected element as the style's source (the
// session's, never the document's or the clipboard's); Paste style gives the selection that element's `style` through core's
// `element.pasteStyle` (style only, never `semantic`; theme tokens as written), one command and so one undo step.
import type { ToolCtx } from './tools.js';

/** Remember the one selected element as the style to paste; false unless exactly one element is selected. */
export function copyStyle(ctx: ToolCtx): boolean {
  const selected = ctx.session.selection.get();
  const only = selected.length === 1 ? selected[0] : undefined;
  if (only === undefined || ctx.view.get(only) === undefined) return false;
  ctx.session.styleSource.set(only);
  return true;
}

/** Paste the copied style onto the selection, one undo step; false with no style copied (or its element gone) or nothing to take it. */
export function pasteStyle(ctx: ToolCtx): boolean {
  const from = ctx.session.styleSource.get();
  if (from === undefined || ctx.view.get(from) === undefined) return false;
  const ids = ctx.session.selection.get().filter((id) => id !== from);
  if (ids.length === 0) return false;
  return ctx.execute('element.pasteStyle', { from, ids }).ok;
}

/**
 * Whether the element menu offers `command` now: Copy style with one element selected, Paste style once a style is copied from an
 * element that is still there and something else is selected; every other line is left to its own rules.
 */
export function offersStyleLine(ctx: ToolCtx, command: string): boolean {
  const selected = ctx.session.selection.get();
  const from = ctx.session.styleSource.get();
  if (command === 'selection.copyStyle') return selected.length === 1;
  if (command === 'selection.pasteStyle') return from !== undefined && ctx.view.get(from) !== undefined && selected.some((id) => id !== from);
  return true;
}
