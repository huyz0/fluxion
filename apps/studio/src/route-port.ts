// The studio's routing worker port (FR-RTE-003, M16.16): the editor's global routing pass runs in a worker. One worker at a time, started
// with the first job; cancelling a job in flight ends its worker (a worker busy in a synchronous pass cannot read a message) and the next
// job starts a fresh one.
import type { GlobalRoutePort } from '@fluxion/editor';
import type { WorkerLike } from '@fluxion/layout/worker';
import type { GlobalRoute } from '@fluxion/routing';

/** A routing worker running the studio's worker module. */
const browserWorker = (): WorkerLike => new Worker(new URL('./route.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

/**
 * The studio's routing port: the editor's port and the way to end its worker.
 *
 * @public
 */
export type RoutePort = GlobalRoutePort & { readonly dispose: () => void };

/**
 * The routing port of an open document. `spawn` starts a routing worker (a test passes its own).
 *
 * @public
 */
export function createRoutePort(spawn: () => WorkerLike = browserWorker): RoutePort {
  let worker: WorkerLike | undefined;
  let next = 0;
  let pending: { readonly id: number; readonly fail: (reason: Error) => void } | undefined;
  const end = () => {
    worker?.terminate();
    worker = undefined;
    pending?.fail(new Error('cancelled'));
    pending = undefined;
  };
  return {
    run: (inputs) =>
      new Promise<readonly GlobalRoute[]>((resolve, reject) => {
        if (pending !== undefined) end();
        const id = ++next;
        const w = worker ?? spawn();
        worker = w;
        pending = { id, fail: reject };
        w.onmessage = ({ data }) => {
          const reply = data as { readonly id?: unknown; readonly routes?: readonly GlobalRoute[] };
          if (reply.id !== pending?.id) return;
          pending = undefined;
          resolve(reply.routes ?? []);
        };
        w.onerror = () => end();
        w.postMessage({ id, inputs });
      }),
    cancel: () => {
      if (pending !== undefined) end();
    },
    dispose: end,
  };
}
