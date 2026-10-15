// The studio's Arrange runner (FR-LAY-007, M13.30): the editor's Arrange commands go through a layout worker, so a large diagram does not block the
// page. One worker host per open document; each arrange reads the snapshot on the page's thread, lays it out in the worker and writes the boxes as one
// undo step (`createAsyncArranger`).
import type { Core } from '@fluxion/core';
import type { ArrangePort } from '@fluxion/editor';
import { createAsyncArranger, type LayoutAlgorithm } from '@fluxion/layout';
import { createLayoutHost, type WorkerLike } from '@fluxion/layout/worker';

/**
 * An Arrange runner over `core` and the way to end its workers.
 *
 * @public
 */
export type ArrangeRunner = {
  /** What the editor's `arrange` takes. */
  readonly port: ArrangePort;
  /** End the workers (the document closed); jobs in flight reject. */
  readonly dispose: () => void;
};

/**
 * The name of the performance mark set just before an Arrange writes its boxes.
 *
 * @public
 */
export const APPLY_MARK = 'fluxion:arrange-apply';

/** A layout worker running the studio's worker module. */
// a DOM Worker has the members WorkerLike names; its handlers take a MessageEvent, which has the `data` the host reads
const browserWorker = (): WorkerLike => new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

/**
 * The Arrange runner of an open document. `spawn` starts a layout worker (the studio's module in a browser; a test passes its own).
 *
 * @public
 */
export function createArrangeRunner(core: Core, spawn: () => WorkerLike = browserWorker): ArrangeRunner {
  const host = createLayoutHost(spawn);
  const arrange = createAsyncArranger({
    store: core.store,
    // the write of the boxes is marked, so a performance test can tell the layout from the write (perf.layout-500.spec.ts)
    execute: (id, args) => {
      if (id === 'layout.applyBoxes') performance.mark(APPLY_MARK);
      return core.execute(id, args);
    },
    host,
    lookup: (name) => core.registries.layouts.get(name) as LayoutAlgorithm<never> | undefined,
  });
  return {
    port: async (request) => {
      const done = await arrange(request);
      return done.ok ? { ok: true } : { ok: false, message: done.error.message };
    },
    dispose: () => host.dispose(),
  };
}
