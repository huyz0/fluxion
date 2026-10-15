// Arranging with a layout in the editor (FR-LAY-005, FR-LAY-001, M13.16): the screen, the selection or a selected container laid out by a
// registered algorithm, each one `layout.arrange` command (registered by the host from `@fluxion/layout`) and so one undo step. The editor
// does not depend on the layout package: it names the command and the algorithms and leaves a host without them with a refusal (false).
import type { RecordId } from '@fluxion/schema';
import { shownScreen } from './screen-switch.js';
import type { ToolCtx } from './tools.js';

/** The layouts the Arrange menu offers, by registered name, with the words people read. */
export const LAYOUT_CHOICES = [
  ['layered', 'layered'],
  ['grid', 'grid'],
  ['stack', 'stack'],
] as const;

/** A layout name the Arrange menu offers. */
export type LayoutChoice = (typeof LAYOUT_CHOICES)[number][0];

/** The kinds of element that hold others and may carry a layout of their own. */
const CONTAINER_KINDS = new Set(['group', 'frame']);

/**
 * Lay out the whole shown screen with `algorithm`. False when no screen is shown or the document refuses (no layout of that name, nothing to lay out).
 *
 * @public
 */
export function arrangeScreen(ctx: ToolCtx, algorithm: LayoutChoice): boolean {
  const screenId = shownScreen(ctx.view, ctx.session.screen.get());
  return screenId !== undefined && ctx.execute('layout.arrange', { screenId, scope: 'screen', algorithm }).ok;
}

/**
 * Lay out the selected elements with `algorithm`; the rest of the screen stays where it is. False with nothing selected or when the document refuses.
 *
 * @public
 */
export function arrangeSelected(ctx: ToolCtx, algorithm: LayoutChoice): boolean {
  const screenId = shownScreen(ctx.view, ctx.session.screen.get());
  const selection = ctx.session.selection.get();
  return screenId !== undefined && selection.length > 1 && ctx.execute('layout.arrange', { screenId, scope: 'selection', selection, algorithm }).ok;
}

/** The one selected group or frame, if the selection is exactly that. */
function selectedContainer(ctx: ToolCtx): RecordId | undefined {
  const [only, ...rest] = ctx.session.selection.get();
  const kind = only === undefined || rest.length > 0 ? undefined : (ctx.view.get(only) as { readonly kind?: unknown } | undefined)?.kind;
  return typeof kind === 'string' && CONTAINER_KINDS.has(kind) ? only : undefined;
}

/**
 * Lay out the children of the selected group or frame with its own layout (else `layered`). False unless exactly one group or frame is selected, or
 * when the document refuses.
 *
 * @public
 */
export function arrangeContainer(ctx: ToolCtx): boolean {
  const screenId = shownScreen(ctx.view, ctx.session.screen.get());
  const containerId = selectedContainer(ctx);
  return screenId !== undefined && containerId !== undefined && ctx.execute('layout.arrange', { screenId, scope: { containerId } }).ok;
}
