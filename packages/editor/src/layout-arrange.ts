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

/**
 * The layouts the Arrange menus offer besides the built-in choices: the keys of the registry entries that have a string `id` and are not `grid`, `layered` or `stack`.
 *
 * @public
 */
export function registeredLayoutIds(entries: readonly (readonly [string, unknown])[]): readonly string[] {
  // `tidy` and `fit` have commands of their own, "Tidy up" and "Fit to screen"
  const builtIn = new Set<string>([...LAYOUT_CHOICES.map(([name]) => name), TIDY, FIT]);
  const ids = entries.flatMap(([key, value]) => (typeof (value as { id?: unknown } | null)?.id === 'string' && !builtIn.has(key) ? [key] : []));
  return [...new Set(ids)].sort();
}

/** The registered name of the minimal-movement cleanup (FR-LAY-011). */
const TIDY = 'tidy';
/** The registered name of the fit into the safe area (FR-LAY-012). */
const FIT = 'fit';

/** The kinds of element that hold others and may carry a layout of their own. */
const CONTAINER_KINDS = new Set(['group', 'frame']);

/**
 * The tools an Arrange reads the session and the document through.
 *
 * @public
 */
export type ArrangeTools = {
  /** The tool context: the session and the document. */
  readonly ctx: ToolCtx;
};

/**
 * What the Arrange commands use of an editor command's context: the tools (and through them the document), the background runner and the notice.
 *
 * @public
 */
export type ArrangeHost = {
  /** The current mode's tools. */
  readonly tools: ArrangeTools;
  /** Runs an Arrange off the main thread; without one it runs on the spot. */
  readonly arrange?: ArrangePort | undefined;
  /** Shows a short notice (an empty one clears it). */
  notify?(message: string): void;
};

/**
 * What an Arrange covers: the whole screen, the selected elements, or the children of one container.
 *
 * @public
 */
export type ArrangeScope = 'screen' | 'selection' | ArrangeContainer;

/**
 * The container whose children an Arrange lays out.
 *
 * @public
 */
export type ArrangeContainer = {
  /** The group or frame. */
  readonly containerId: RecordId;
};

/**
 * What an Arrange asks of the layout engine: the arguments of the `layout.arrange` command.
 *
 * @public
 */
export type ArrangeRequest = {
  /** The screen to lay out. */
  readonly screenId: RecordId;
  /** All of the screen, the selected elements, or the children of one container. */
  readonly scope: ArrangeScope;
  /** The selected elements, for the `selection` scope. */
  readonly selection?: readonly RecordId[];
  /** The layout to use (a container's own layout wins); `layered` when omitted. */
  readonly algorithm?: string;
};

/**
 * How an Arrange ended.
 *
 * @public
 */
export type ArrangeOutcome = {
  /** True when the boxes were written. */
  readonly ok: boolean;
  /** Why not, as a sentence. */
  readonly message?: string;
};

/**
 * Runs an Arrange off the main thread (the studio's, through a layout worker); without one the editor runs the command on the spot.
 *
 * @public
 */
export type ArrangePort = (request: ArrangeRequest) => Promise<ArrangeOutcome>;

/**
 * Start an Arrange. With a port in `ctx` it runs in the background: the notice says it is working, then clears or says why it failed, and the
 * command counts as taken. Without one the command runs at once, and its refusal is the result.
 */
function start(ctx: ArrangeHost, request: ArrangeRequest): boolean {
  const port = ctx.arrange;
  if (port === undefined) return ctx.tools.ctx.execute('layout.arrange', request).ok;
  // only the newest request of a port speaks: an older one that ends after it (superseded) leaves the notice alone
  const mine = (newest.get(port) ?? 0) + 1;
  newest.set(port, mine);
  const say = (message: string): void => {
    if (newest.get(port) === mine) ctx.notify?.(message);
  };
  say('Arranging…');
  void port(request).then(
    (done) => say(done.ok ? '' : `Could not arrange: ${done.message ?? 'the layout was refused'}`),
    (error: unknown) => say(`Could not arrange: ${error instanceof Error ? error.message : 'the layout was cancelled'}`),
  );
  return true;
}

/** The number of the newest request of each port. */
const newest = new WeakMap<ArrangePort, number>();

/**
 * Lay out the whole shown screen with `algorithm`. False when no screen is shown or the document refuses (no layout of that name, nothing to lay out).
 *
 * @public
 */
export function arrangeScreen(ctx: ArrangeHost, algorithm: string): boolean {
  const screenId = shownScreen(ctx.tools.ctx.view, ctx.tools.ctx.session.screen.get());
  return screenId !== undefined && start(ctx, { screenId, scope: 'screen', algorithm });
}

/**
 * Lay out the selected elements with `algorithm`; the rest of the screen stays where it is. False with fewer than two selected or when the document refuses.
 *
 * @public
 */
export function arrangeSelected(ctx: ArrangeHost, algorithm: string): boolean {
  const t = ctx.tools.ctx;
  const screenId = shownScreen(t.view, t.session.screen.get());
  const selection = t.session.selection.get();
  return screenId !== undefined && selection.length > 1 && start(ctx, { screenId, scope: 'selection', selection, algorithm });
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
export function arrangeContainer(ctx: ArrangeHost): boolean {
  const t = ctx.tools.ctx;
  const screenId = shownScreen(t.view, t.session.screen.get());
  const containerId = selectedContainer(t);
  return screenId !== undefined && containerId !== undefined && start(ctx, { screenId, scope: { containerId } });
}

/**
 * Tidy up (FR-LAY-011): align near-aligned boxes, snap them to the grid and pull overlapping ones apart, each moved a bounded distance; the
 * selected elements when two or more are selected, else the whole shown screen. False when there is nothing to tidy or the document refuses.
 *
 * @public
 */
export function tidyUp(ctx: ArrangeHost): boolean {
  return ctx.tools.ctx.session.selection.get().length > 1 ? arrangeSelected(ctx, TIDY) : arrangeScreen(ctx, TIDY);
}

/**
 * Fit to screen (FR-LAY-012): scale the shown screen's content down together and move it into the screen's safe area; content already inside
 * stays, and so does a pinned (hand-placed) shape (M17.31). Always the whole screen, whatever is selected. False when there is no screen or the
 * document refuses.
 *
 * @public
 */
export function fitToScreen(ctx: ArrangeHost): boolean {
  return arrangeScreen(ctx, FIT);
}
