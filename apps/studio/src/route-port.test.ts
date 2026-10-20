// FR-RTE-003: the studio's routing port runs the global pass in a worker; cancelling ends the worker and the next job starts a fresh one.
import type { WorkerLike } from '@fluxion/layout/worker';
import { type GlobalRouteInput, globalRoutes } from '@fluxion/routing';
import { describe, expect, it } from 'vitest';
import { createRoutePort, globalRoutingAsked } from './route-port.js';

const input: GlobalRouteInput = {
  obstacles: [],
  connectors: [{ id: 'c', source: { point: { x: 0, y: 0 }, dir: { x: 1, y: 0 } }, target: { point: { x: 200, y: 100 }, dir: { x: -1, y: 0 } } }],
};

/** A worker that answers like the studio's module, in a later microtask; `silent` never answers. */
function fakeWorker(log: string[], silent = false): WorkerLike {
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (m) => {
      const job = m as { id: number; inputs: GlobalRouteInput[] };
      if (!silent) void Promise.resolve().then(() => worker.onmessage?.({ data: { id: job.id, routes: job.inputs.flatMap(globalRoutes) } }));
    },
    terminate: () => void log.push('terminate'),
  };
  log.push('spawn');
  return worker;
}

describe('the routing worker port (FR-RTE-003)', () => {
  it('FR-RTE-003: a job comes back with the global pass of its inputs, from one worker reused', async () => {
    const log: string[] = [];
    const port = createRoutePort(() => fakeWorker(log));
    expect(await port.run([input])).toEqual(globalRoutes(input));
    expect(await port.run([input])).toEqual(globalRoutes(input));
    expect(log).toEqual(['spawn']);
    port.dispose();
    expect(log).toEqual(['spawn', 'terminate']);
  });

  it('FR-RTE-003: a cancelled job rejects and ends its worker; the next job starts a fresh one', async () => {
    const log: string[] = [];
    let silent = true;
    const port = createRoutePort(() => fakeWorker(log, silent));
    const first = port.run([input]);
    port.cancel();
    await expect(first).rejects.toThrow('cancelled');
    expect(log).toEqual(['spawn', 'terminate']);
    silent = false;
    expect(await port.run([input])).toEqual(globalRoutes(input));
    expect(log).toEqual(['spawn', 'terminate', 'spawn']);
    // nothing in flight: cancel ends nothing
    port.cancel();
    expect(log).toHaveLength(3);
  });

  it('FR-EDT-010: the global routes are drawn only when the page asks for them, so edit draws what present and the file draw by default', () => {
    expect(globalRoutingAsked('')).toBe(false);
    expect(globalRoutingAsked('?src=x.flux')).toBe(false);
    expect(globalRoutingAsked('?routing=cheap')).toBe(false);
    expect(globalRoutingAsked('?routing=global')).toBe(true);
    expect(globalRoutingAsked('?log=*&routing=global')).toBe(true);
  });
});
