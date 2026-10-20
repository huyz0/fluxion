// The routing chunk's entry (M16.28, ADR-0044 amendment; NFR-SIZE-001: heavy features are lazy chunks): the global routing pass alone,
// bundled by tsdown into `dist/fluxion-routing.js`, a classic script that defines the global `FluxionRouting`. The player runs it as a
// worker (routing-chunk-loader.ts), where it answers each `{ id, input }` with `{ id, routes }`: the pass never runs on the main thread
// (performance.md rule 9). Its input and output are plain data, so it shares no state with the player.
import { type GlobalRouteInput, globalRoutes } from '@fluxion/routing';

type WorkerScope = {
  onmessage: ((e: { readonly data: { readonly id: number; readonly input: GlobalRouteInput } }) => void) | null;
  postMessage: (message: unknown) => void;
};

// in a worker (no document): answer the player's screens; on a page the script only defines the global
const scope = globalThis as unknown as Partial<WorkerScope> & { readonly document?: unknown };
if (scope.document === undefined && typeof scope.postMessage === 'function') {
  const worker = scope as WorkerScope;
  worker.onmessage = ({ data }) => worker.postMessage({ id: data.id, routes: globalRoutes(data.input) });
}

export { globalRoutes };
