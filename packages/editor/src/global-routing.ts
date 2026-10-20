// The global routing pass on drop (FR-RTE-003, ADR-0044): once the document stops changing (a drag dropped, an edit made), every
// screen's orthogonal connectors go to the port (a worker in the studio) as one batch; the routes that come back are drawn instead
// of the cheap ones (routing's `RouteContext.refined`) only if no change that could move a route came since they were asked. Such a
// change clears them at once (the cheap routes are right for the new geometry) and asks again once it settles; a job a change overtook
// is cancelled and its late answer dropped. A change that moves no route (a name, a style, text) leaves them drawn.
import { type Diff, effect, type ReadSignal, type Store, writable } from '@fluxion/core';
import type { PathCommand } from '@fluxion/geometry';
import { type GlobalRoute, type GlobalRouteInput, globalRouteInput, type RouteContext } from '@fluxion/routing';
import type { RecordId } from '@fluxion/schema';

/** Element fields that move no route: neither an obstacle's box nor a connector's ends or type (FR-RTE-003). */
const ROUTE_FREE = new Set([
  'meta',
  'name',
  'style',
  'semantic',
  'locks',
  'matchKey',
  'hidden',
  'index',
  'textFit',
  'markers',
  'labels',
  'text',
  'autoSize',
  'assetId',
  'crop',
  'fit',
  'clip',
]);

/** Whether `diff` could move a route: anything but a change to existing elements' route-free fields. */
function movesRoutes(diff: Diff): boolean {
  if (diff.deletes.size > 0) return true;
  for (const { before, after } of diff.puts.values()) {
    if (before === undefined || before.type !== 'element' || after.type !== 'element') return true;
    const b = before as Readonly<Record<string, unknown>>;
    const a = after as Readonly<Record<string, unknown>>;
    for (const key of new Set([...Object.keys(b), ...Object.keys(a)]))
      if (!ROUTE_FREE.has(key) && JSON.stringify(b[key]) !== JSON.stringify(a[key])) return true;
  }
  return false;
}

/**
 * How long the document stays unchanged before the global pass runs, ms: longer than a frame of a drag, short after a drop.
 *
 * @public
 */
export const GLOBAL_ROUTE_SETTLE_MS = 200;

/**
 * Where the global pass runs (a worker): `run` routes the screens' inputs; `cancel` abandons the job in flight.
 *
 * @public
 */
export type GlobalRoutePort = {
  /** The routes of every connector of `inputs` the pass could route. */
  run(inputs: readonly GlobalRouteInput[]): Promise<readonly GlobalRoute[]>;
  /** Abandon the job in flight, if any (its promise may still settle; the answer is dropped). */
  cancel(): void;
};

/**
 * The global pass over a store: `refined` is the routes to draw while they are current.
 *
 * @public
 */
export type GlobalRouting = {
  /** The global pass's routes by connector id, for the current revision; undefined while none are. */
  readonly refined: ReadSignal<ReadonlyMap<string, readonly PathCommand[]> | undefined>;
  /** Stop following the store and cancel the job in flight. */
  dispose(): void;
};

/**
 * Runs the global routing pass of `store` through `port` whenever the document settles, `settleMs` after its last change (and once at
 * the start), routing with `ctx` (shape definitions and routers).
 *
 * @public
 */
export function createGlobalRouting(store: Store, ctx: RouteContext, port: GlobalRoutePort, settleMs: number = GLOBAL_ROUTE_SETTLE_MS): GlobalRouting {
  const refined = writable<ReadonlyMap<string, readonly PathCommand[]> | undefined>(undefined);
  // the router context without the refined routes: the input is built from the cheap pass's ends
  const cheap: RouteContext = { shapeDefs: ctx.shapeDefs, routers: ctx.routers };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let job = 0;
  const start = () => {
    timer = undefined;
    const mine = ++job;
    const screens = [...(store.members('byType', 'screen') as RecordId[])].sort();
    const inputs = screens.map((s) => globalRouteInput(store, cheap, s)).filter((input) => input.connectors.length > 0);
    if (inputs.length === 0) return;
    port.run(inputs).then(
      (routes) => {
        // a newer job, or a change that moved a route since (it bumps `job`), makes these routes stale: dropped
        if (mine === job) refined.set(new Map(routes.map((r) => [r.id, r.commands])));
      },
      () => undefined,
    );
  };
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(start, settleMs);
  };
  const invalidate = () => {
    job++;
    port.cancel();
    refined.set(undefined);
    schedule();
  };
  const stop = store.subscribe((diff) => {
    if (movesRoutes(diff)) invalidate();
  });
  // a shape definition (its outline, its anchors) or a router registered, replaced or disposed moves routes without a store change
  let first = true;
  const stopRegistries = effect(() => {
    ctx.shapeDefs.changes$();
    ctx.routers.changes$();
    if (!first) invalidate();
    first = false;
  });
  schedule();
  return {
    refined: refined.get,
    dispose: () => {
      stop();
      stopRegistries();
      if (timer !== undefined) clearTimeout(timer);
      job++;
      port.cancel();
    },
  };
}
