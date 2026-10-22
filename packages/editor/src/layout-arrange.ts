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
  /** Live layout (FR-LAY-006): the children the edit added, removed or resized; the others stay where they are as far as the layout can. */
  readonly changed?: readonly RecordId[];
  /** The options of the layout, for the `algorithm` when no layout spec of the target gives its own (the options form, M17.34). */
  readonly options?: unknown;
  /** Live layout (FR-LAY-010): the boxes are written into the undo entry of the edit that asked, not an entry of their own. */
  readonly amend?: true;
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
function start(ctx: ArrangeHost, request: ArrangeRequest, after: () => string = () => ''): boolean {
  const port = ctx.arrange;
  if (port === undefined) {
    const ok = ctx.tools.ctx.execute('layout.arrange', request).ok;
    const message = ok ? after() : '';
    if (message !== '') ctx.notify?.(message);
    return ok;
  }
  // only the newest request of a port speaks: an older one that ends after it (superseded) leaves the notice alone
  const mine = (newest.get(port) ?? 0) + 1;
  newest.set(port, mine);
  const say = (message: string): void => {
    if (newest.get(port) === mine) ctx.notify?.(message);
  };
  say('Arranging…');
  void port(request).then(
    (done) => say(done.ok ? after() : `Could not arrange: ${done.message ?? 'the layout was refused'}`),
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

/** The share of a screen's smaller side between its edge and its safe area: the `fit` layout's default margin (FR-LAY-012). */
const SAFE_SHARE = 0.05;

type Placed = {
  readonly type?: string;
  readonly name?: unknown;
  readonly hidden?: unknown;
  readonly parentId?: unknown;
  readonly placement?: unknown;
  readonly locks?: { readonly position?: unknown };
  readonly transform?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
};

/** The area `fit` puts content in: the screen (1920 x 1080 when it has no size; an infinite screen's viewport) inset by its safe margin. */
function safeAreaOf(screen: unknown): { x: number; y: number; w: number; h: number } {
  const s = (screen ?? {}) as { kind?: unknown; size?: { w?: unknown; h?: unknown }; viewport?: { x: number; y: number; w: number; h: number } };
  const [w, h] = [s.size?.w, s.size?.h];
  const frame =
    s.kind === 'infinite' && s.viewport
      ? s.viewport
      : { x: 0, y: 0, w: typeof w === 'number' && w > 0 ? w : 1920, h: typeof h === 'number' && h > 0 ? h : 1080 };
  const margin = SAFE_SHARE * Math.min(frame.w, frame.h);
  return { x: frame.x + margin, y: frame.y + margin, w: frame.w - 2 * margin, h: frame.h - 2 * margin };
}

/** Whether `r` is a top-level element `fit` leaves where it is (placed by hand, or locked in place) that is not wholly inside `area`. */
function leftOutside(r: Placed | undefined, area: { x: number; y: number; w: number; h: number }): boolean {
  const b = r?.transform;
  // a hidden element is not laid out, so it is not named either
  if (r?.type !== 'element' || r.parentId !== undefined || r.hidden === true || b === undefined) return false;
  if (r.placement !== 'pinned' && r.locks?.position !== true) return false;
  return b.x < area.x || b.y < area.y || b.x + b.w > area.x + area.w || b.y + b.h > area.y + area.h;
}

/**
 * The notice after a fit (M17.31): the pinned elements still outside the safe area, by name (else "a shape"), at most three named; empty when there
 * are none.
 */
function leftOutsideNotice(view: ToolCtx['view'], screenId: RecordId): string {
  const area = safeAreaOf(view.get(screenId));
  const left = view.members('byScreen', screenId).filter((id) => leftOutside(view.get(id) as Placed | undefined, area));
  if (left.length === 0) return '';
  const names = left.slice(0, 3).map((id) => {
    const name = (view.get(id) as Placed | undefined)?.name;
    return typeof name === 'string' && name !== '' ? `"${name}"` : 'a shape';
  });
  const more = left.length > 3 ? ` and ${left.length - 3} more` : '';
  const one = left.length === 1;
  return `Left in place, outside the safe area: ${names.join(', ')}${more} (${one ? 'it is' : 'they are'} pinned or locked, so Fit does not move ${one ? 'it' : 'them'}).`;
}

/**
 * Fit to screen (FR-LAY-012): scale the shown screen's content down together and move it into the screen's safe area; content already inside
 * stays, and so does a pinned (hand-placed or position-locked) shape (ADR-0031): a pinned shape left outside the safe area is named in a notice
 * (M17.31). Always the whole screen, whatever is selected. False when there is no screen or the document refuses.
 *
 * @public
 */
export function fitToScreen(ctx: ArrangeHost): boolean {
  const t = ctx.tools.ctx;
  const screenId = shownScreen(t.view, t.session.screen.get());
  return screenId !== undefined && start(ctx, { screenId, scope: 'screen', algorithm: FIT }, () => leftOutsideNotice(t.view, screenId));
}
