// Settled routes (FR-RTE-003, ADR-0044 amendment M16.28): every renderer draws the global routing pass's routes once the document is
// still. A host that runs the pass in a worker (the studio, and the one-file player with its lazily loaded routing chunk) hands its
// overlay in as `registries.refined`; a host where the pass may block, as a batch (the CLI and the exporters), hands the pure pass in as
// `registries.globalPass`, and the views run it here, as a store query per screen, on the thread that renders: never a page's (it takes
// hundreds of ms on a busy screen, performance.md rule 9). Render never imports the pass: the player's script would carry it (NFR-SIZE-001).
import type { ReadSignal, Store } from '@fluxion/core';
import type { PathCommand } from '@fluxion/geometry';
import { globalRouteInput, type RouteContext } from '@fluxion/routing';
import type { RecordId } from '@fluxion/schema';
import type { GlobalPass, RenderRegistries } from './registries.js';

type Routes = ReadonlyMap<string, readonly PathCommand[]>;
type ScreenRoutes = readonly (readonly [string, readonly PathCommand[]])[];

/**
 * The global pass's routes of every screen of `store`, routed with `ctx`'s shape definitions and routers by the pass `pass` holds: one query
 * per screen; undefined while `pass` holds none (the cheap routes are drawn).
 */
function settledRoutes(store: Store, ctx: RouteContext, pass: ReadSignal<GlobalPass | undefined>): ReadSignal<Routes | undefined> {
  // the input is built from the cheap pass's ends, as the editor's worker pass builds it
  const cheap: RouteContext = { shapeDefs: ctx.shapeDefs, routers: ctx.routers };
  const screens = new Map<RecordId, ReadSignal<ScreenRoutes>>();
  const ofScreen = (id: RecordId, run: GlobalPass) => {
    let q = screens.get(id);
    if (q === undefined) {
      q = store.query((view) => {
        const input = globalRouteInput(view, cheap, id);
        return input.connectors.length === 0 ? [] : run(input).map((r) => [r.id, r.commands] as const);
      });
      screens.set(id, q);
    }
    return q;
  };
  let previous: Routes = new Map();
  return store.query((view) => {
    const run = pass();
    if (run === undefined) return undefined;
    const ids = view.members('byType', 'screen') as readonly RecordId[];
    for (const id of screens.keys()) if (!ids.includes(id)) screens.delete(id);
    previous = stable(new Map(ids.flatMap((id) => ofScreen(id, run)())), previous);
    return previous;
  });
}

const sameCommands = (p: readonly PathCommand[], q: readonly PathCommand[] | undefined): boolean =>
  q !== undefined && p.length === q.length && p.every((c, k) => JSON.stringify(c) === JSON.stringify(q[k]));

/**
 * `next` with every route equal to the one in `previous` replaced by it, or `previous` itself when nothing changed: a change elsewhere
 * leaves the map, and so every connector view that reads it, alone.
 */
function stable(next: Map<string, readonly PathCommand[]>, previous: Routes): Routes {
  let changed = next.size !== previous.size;
  for (const [id, commands] of next) {
    const before = previous.get(id);
    if (before !== undefined && sameCommands(commands, before)) next.set(id, before);
    else changed = true;
  }
  return changed ? next : previous;
}

const made = new WeakMap<Store, WeakMap<RenderRegistries, RenderRegistries>>();

/**
 * `registries` as every renderer routes with them: as they are when they carry a global pass overlay (`refined`) or no pass at all, else
 * with `globalPass` run over `store` as their overlay. The same registries for the same store and registries, so views and queries keyed on
 * them are shared.
 *
 * @public
 */
export function withSettledRoutes(store: Store, registries: RenderRegistries): RenderRegistries {
  const pass = registries.globalPass;
  if (registries.refined !== undefined || pass === undefined) return registries;
  const byRegistries = made.get(store) ?? new WeakMap<RenderRegistries, RenderRegistries>();
  made.set(store, byRegistries);
  const known = byRegistries.get(registries);
  if (known !== undefined) return known;
  const settled = { ...registries, refined: settledRoutes(store, registries, pass) };
  byRegistries.set(registries, settled);
  return settled;
}
