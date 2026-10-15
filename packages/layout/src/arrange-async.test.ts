// FR-LAY-007 and FR-LAY-005: arranging off the caller's thread. The worker is a loopback whose replies the test releases by hand, so the
// document can change while a job is out.
import { type Core, createCore } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { createAsyncArranger, layeredLayout, registerArrangeCommand, registerBuiltInLayouts } from './index.js';
import { createLayoutHost, serveLayoutWorker, type WorkerLike } from './worker/index.js';

type Box = { x: number; y: number; w: number; h: number };
const shape = (id: string, [x, y]: readonly [number, number], extra: Record<string, unknown> = {}) => ({
  id,
  type: 'element',
  screenId: 's1',
  index: `a${id}`,
  kind: 'shape',
  defId: 'basic:rect',
  transform: { x, y, w: 100, h: 50 },
  ...extra,
});

function core(elements: ReadonlyArray<ReturnType<typeof shape>>): Core {
  const records = Object.fromEntries([
    ['doc', { id: 'doc', type: 'document', title: 'Arrange' }],
    ['s1', { id: 's1', type: 'screen', index: 'a0', name: 'Main' }],
    ...elements.map((e) => [e.id, e] as const),
  ]);
  const c = createCore({ schemaVersion: '1.3', records } as never);
  registerBuiltInLayouts(c.registries.layouts);
  registerArrangeCommand(c.registries.commands, c.registries.layouts);
  return c;
}

/** A worker that answers each job when the test calls `release()`. */
function heldWorkers(): { spawn: () => WorkerLike; release: () => void; spawned: () => number } {
  const waiting: Array<() => void> = [];
  let spawned = 0;
  const spawn = (): WorkerLike => {
    spawned += 1;
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: (m) => scope.onmessage?.({ data: m }),
      terminate: () => undefined,
    };
    const scope = {
      onmessage: null as ((event: { readonly data: unknown }) => void) | null,
      postMessage: (reply: unknown) => void waiting.push(() => worker.onmessage?.({ data: reply })),
    };
    serveLayoutWorker(scope, (name) => (name === 'layered' ? (layeredLayout as never) : undefined));
    return worker;
  };
  return {
    spawn,
    release: () => {
      for (const f of waiting.splice(0)) f();
    },
    spawned: () => spawned,
  };
}

const lookupIn = (c: Core) => (name: string) => c.registries.layouts.get(name) as never;
const arranger = (c: Core, workers: ReturnType<typeof heldWorkers>) =>
  createAsyncArranger({ store: c.store, execute: c.execute, host: createLayoutHost(workers.spawn), lookup: lookupIn(c) });
const boxesOf = (c: Core, ids: readonly string[]): Box[] => ids.map((id) => (c.store.get(id as never) as unknown as { transform: Box }).transform);
const IDS = ['a', 'b', 'c'] as const;
const three = () => [shape('a', [0, 0]), shape('b', [10, 10]), shape('c', [20, 20])];

describe('async arrange (FR-LAY-007, FR-LAY-005)', () => {
  it('FR-LAY-007: a flat screen arranged in a worker gets the boxes layout.arrange gives, as one undo step', async () => {
    const sync = core(three());
    expect(sync.execute('layout.arrange', { screenId: 's1', algorithm: 'layered' }).ok).toBe(true);
    const c = core(three());
    const before = boxesOf(c, IDS);
    const workers = heldWorkers();
    const pending = arranger(c, workers)({ screenId: 's1', algorithm: 'layered' });
    expect(boxesOf(c, IDS)).toEqual(before);
    workers.release();
    expect(await pending).toMatchObject({ ok: true, value: { moved: 3 } });
    expect(boxesOf(c, IDS)).toEqual(boxesOf(sync, IDS));
    expect(c.store.history.undo().ok).toBe(true);
    expect(boxesOf(c, IDS)).toEqual(before);
    expect(c.store.history.canUndo()).toBe(false);
  });

  it('FR-LAY-005: a plan with nested containers is laid out by layout.arrange on the caller and no worker starts', async () => {
    const frame = shape('f', [200, 100], { kind: 'frame', layout: { type: 'layered' } });
    const c = core([frame, shape('k1', [0, 0], { parentId: 'f' }), shape('k2', [0, 0], { parentId: 'f' })]);
    const workers = heldWorkers();
    const result = await arranger(c, workers)({ screenId: 's1', algorithm: 'layered' });
    expect(result.ok).toBe(true);
    expect(workers.spawned()).toBe(0);
    expect(boxesOf(c, ['k1', 'k2'])[0]).not.toEqual(boxesOf(c, ['k1', 'k2'])[1]);
  });

  it('FR-LAY-007: a screen edited while the worker ran is refused and nothing is written', async () => {
    const c = core(three());
    const workers = heldWorkers();
    const pending = arranger(c, workers)({ screenId: 's1', algorithm: 'layered' });
    const edit = c.execute('element.update', { id: 'a', fields: { transform: { x: 500, y: 500, w: 100, h: 50 } } });
    expect(edit.ok).toBe(true);
    const depth = c.store.history.undoDepth;
    workers.release();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'LAYOUT_INPUT_INVALID' } });
    expect(c.store.history.undoDepth).toBe(depth);
    expect(boxesOf(c, ['a'])[0]).toEqual({ x: 500, y: 500, w: 100, h: 50 });
  });

  it('FR-LAY-007: a newer arrange of a screen supersedes the older one, which rejects with AbortError', async () => {
    const c = core(three());
    const workers = heldWorkers();
    const run = arranger(c, workers);
    const older = run({ screenId: 's1', algorithm: 'layered' }).then(
      () => undefined,
      (e: Error) => e,
    );
    const newer = run({ screenId: 's1', algorithm: 'layered' });
    expect((await older)?.name).toBe('AbortError');
    workers.release();
    expect(await newer).toMatchObject({ ok: true });
  });

  it('FR-LAY-005: a request layout.arrange would refuse comes back as an error with nothing started, and applyBoxes writes only elements of the screen', async () => {
    const c = core(three());
    const workers = heldWorkers();
    const run = arranger(c, workers);
    for (const args of [{ screenId: 's1', algorithm: 'tree' }, { screenId: 'nowhere' }, { screenId: 7 }, { screenId: 's1', scope: { containerId: 's1' } }]) {
      expect(await run(args)).toMatchObject({ ok: false, error: { code: 'LAYOUT_INPUT_INVALID' } });
    }
    expect(workers.spawned()).toBe(0);
    const box = { x: 1, y: 1, w: 5, h: 5 };
    expect(c.execute('layout.applyBoxes', { screenId: 's1', boxes: { s1: box } })).toMatchObject({ ok: false, error: { code: 'COMMAND_ARGS' } });
    expect(c.execute('layout.applyBoxes', { screenId: 's1', boxes: { a: { ...box, w: -1 } } }).ok).toBe(false);
    expect(c.execute('layout.applyBoxes', { screenId: 's1', boxes: { a: box } })).toMatchObject({ ok: true, value: { moved: 1 } });
    expect(boxesOf(c, ['a'])[0]).toEqual(box);
  });
});
