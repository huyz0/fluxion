// The global routes of a presented file, routed in the chunk's worker (M16.28, ADR-0044 amendment): one screen at a time, each screen's
// routes drawn as they arrive. The player's store refuses every write, so the inputs are built once; render draws a route only while it
// joins its connector's current ends, as for the studio's worker overlay.
import { type ReadSignal, type Store, writable } from '@fluxion/core';
import type { RenderRegistries } from '@fluxion/render';
import { globalRouteInput, type RouteContext } from '@fluxion/routing';
import type { RecordId } from '@fluxion/schema';
import type { RoutingWorker } from './routing-chunk-loader.js';

/** A screen's routes by connector id, as render's `refined` overlay holds them. */
type Routes = NonNullable<ReturnType<NonNullable<RenderRegistries['refined']>>>;

/** How long the pass waits for the views to draw before it starts anyway. */
const FIRST_PAINT_MS = 500;

/** Run `then` once the next frame is painted (a task after the frame), or after a while in a page that paints no frames (a hidden tab). */
function afterPaint(then: () => void): void {
  let ran = false;
  const once = () => {
    if (ran) return;
    ran = true;
    then();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(once, 0));
  setTimeout(once, 100);
}

/**
 * Route `store`'s screens with `registries`' shape definitions and routers in `worker`, once the cheap routes are painted: `refined` holds the routes
 * that have arrived (undefined before any has); `done` settles true once every screen is routed, false when the worker failed.
 */
export function workerRoutes(
  store: Store,
  registries: RenderRegistries,
  worker: RoutingWorker,
): { readonly refined: ReadSignal<Routes | undefined>; readonly done: Promise<boolean> } {
  const refined = writable<Routes | undefined>(undefined);
  // the input is built from the cheap pass's ends, as the studio's worker pass builds it
  const cheap: RouteContext = { shapeDefs: registries.shapeDefs, routers: registries.routers };
  // the pass starts once the views have drawn the cheap routes (their first read of the overlay) and the frame is painted, or after
  // FIRST_PAINT_MS when nothing has read it (the screen shown has no connectors)
  let begin: () => void = () => undefined;
  const begun = new Promise<void>((resolve) => {
    begin = () => {
      begin = () => undefined;
      afterPaint(resolve);
    };
  });
  setTimeout(() => begin(), FIRST_PAINT_MS);
  const done = (async () => {
    await begun;
    let ok = true;
    for (const id of store.members('byType', 'screen') as readonly RecordId[]) {
      const input = globalRouteInput(store, cheap, id);
      if (input.connectors.length === 0) continue;
      const routes = await worker.route(input);
      if (routes === undefined) {
        ok = false;
        break;
      }
      refined.set(new Map([...(refined.get() ?? []), ...routes.map((r) => [r.id, r.commands] as const)]) as Routes);
    }
    return ok;
  })();
  return {
    refined: () => {
      begin();
      return refined.get();
    },
    done,
  };
}
