// FR-LAY-007, FR-LAY-005: the studio's Arrange runner lays a document's screen out through a layout worker and writes the boxes as one undo step.
import { createCore } from '@fluxion/core';
import { layeredLayout, registerArrangeCommand, registerBuiltInLayouts } from '@fluxion/layout';
import { serveLayoutWorker, type WorkerLike } from '@fluxion/layout/worker';
import { describe, expect, it } from 'vitest';
import { createArrangeRunner } from './arrange-port.js';

const shape = (id: string, x: number) => ({
  id,
  type: 'element',
  screenId: 's1',
  index: `a${id}`,
  kind: 'shape',
  defId: 'basic:rect',
  transform: { x, y: 0, w: 100, h: 50 },
});

function open() {
  const records = Object.fromEntries([
    ['doc', { id: 'doc', type: 'document', title: 'Arrange' }],
    ['s1', { id: 's1', type: 'screen', index: 'a0', name: 'Main' }],
    ...[shape('a', 0), shape('b', 10), shape('c', 20)].map((e) => [e.id, e] as const),
  ]);
  const core = createCore({ schemaVersion: '1.3', records } as never);
  registerBuiltInLayouts(core.registries.layouts);
  registerArrangeCommand(core.registries.commands, core.registries.layouts);
  return core;
}

/** A worker on the same thread that answers in the next microtask, as a real one answers on a message. */
function loopback(): WorkerLike {
  const worker: WorkerLike = { onmessage: null, onerror: null, postMessage: (m) => scope.onmessage?.({ data: m }), terminate: () => undefined };
  const scope = {
    onmessage: null as ((event: { readonly data: unknown }) => void) | null,
    postMessage: (reply: unknown) => void Promise.resolve().then(() => worker.onmessage?.({ data: reply })),
  };
  serveLayoutWorker(scope, (name) => (name === 'layered' ? (layeredLayout as never) : undefined));
  return worker;
}

describe('studio arrange runner (FR-LAY-007, FR-LAY-005)', () => {
  it('FR-LAY-007: an Arrange runs in the worker, moves the elements, is one undo step, and a refusal comes back as a message', async () => {
    const core = open();
    const runner = createArrangeRunner(core, loopback);
    const before = JSON.stringify(core.store.toDocument().records);
    expect(await runner.port({ screenId: 's1' as never, scope: 'screen', algorithm: 'layered' })).toEqual({ ok: true });
    expect(JSON.stringify(core.store.toDocument().records)).not.toBe(before);
    expect(core.store.history.undo().ok).toBe(true);
    expect(JSON.stringify(core.store.toDocument().records)).toBe(before);
    const refused = await runner.port({ screenId: 'nowhere' as never, scope: 'screen' });
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/no elements/);
    runner.dispose();
  });
});
