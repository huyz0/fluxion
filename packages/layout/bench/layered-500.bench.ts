// NFR-PERF-005 (layout part), FR-LAY-007: a 500-node `layered` layout as the worker runs it: a job through the host and the worker protocol
// (message in, `layoutSync`, message out). The worker here is a loopback on the same thread, so the bench measures the host, the protocol
// and the layout, not the cost of another thread; that the main thread stays free is the browser spec `perf.layout-500.spec.ts` (M13.19).
// The M13 gate's bench leg holds the p99 of `layered-500` to LAYOUT_500_NODES_MS and to 15 % over perf-baseline.json.
import { describe, expect, test } from 'vitest';
import { layeredLayout } from '../src/index.js';
import { createLayoutHost, serveLayoutWorker, type WorkerLike } from '../src/worker/index.js';
import { graph } from './graph.js';

/** A worker that answers on the same thread, in the next microtask, as a real one answers on a message. */
function loopback(): WorkerLike {
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => scope.onmessage?.({ data: message }),
    terminate: () => undefined,
  };
  const scope = {
    onmessage: null as ((event: { readonly data: unknown }) => void) | null,
    postMessage: (reply: unknown) => void Promise.resolve().then(() => worker.onmessage?.({ data: reply })),
  };
  serveLayoutWorker(scope, (name) => (name === layeredLayout.id ? (layeredLayout as never) : undefined));
  return worker;
}

describe('layered layout in the worker (NFR-PERF-005, FR-LAY-007)', () => {
  test('NFR-PERF-005: layered-500', async ({ bench }) => {
    const host = createLayoutHost(loopback);
    const input = graph(500);
    const job = { scope: 'bench', algorithm: layeredLayout.id, input, revision: 0 };
    const first = await host.run({ ...job, revision: 1 });
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.metrics.overlaps).toBe(0);
    let revision = 1;
    await bench('layered-500', { async: true }, async () => {
      revision += 1;
      await host.run({ ...job, revision });
    }).run({ time: 2_000, warmupTime: 0, warmupIterations: 2, iterations: 20 });
    host.dispose();
  });
});
