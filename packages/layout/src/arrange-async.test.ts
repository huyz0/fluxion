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
/** A turn of the event loop: the arranger's pause before its snapshot has passed and the worker has the job. */
const later = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};
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
    for (const args of [
      { screenId: 's1', algorithm: 'no-such-layout' },
      { screenId: 'nowhere' },
      { screenId: 7 },
      { screenId: 's1', scope: { containerId: 's1' } },
    ]) {
      expect(await run(args)).toMatchObject({ ok: false, error: { code: 'LAYOUT_INPUT_INVALID' } });
    }
    expect(workers.spawned()).toBe(0);
    const box = { x: 1, y: 1, w: 5, h: 5 };
    expect(c.execute('layout.applyBoxes', { screenId: 's1', boxes: { s1: box } })).toMatchObject({ ok: false, error: { code: 'COMMAND_ARGS' } });
    expect(c.execute('layout.applyBoxes', { screenId: 's1', boxes: { a: { ...box, w: -1 } } }).ok).toBe(false);
    expect(c.execute('layout.applyBoxes', { screenId: 's1', boxes: { a: box } })).toMatchObject({ ok: true, value: { moved: 1 } });
    expect(boxesOf(c, ['a'])[0]).toEqual(box);
  });

  it('FR-LAY-007: a large result is written in slices with the thread given back between them, as one undo step; a slice whose elements changed ends it', async () => {
    const many = () => Array.from({ length: 7 }, (_, i) => shape('pqrstuv'[i] as string, [i, i]));
    const ids = many().map((e) => e.id);
    const sync = core(many());
    sync.execute('layout.arrange', { screenId: 's1', algorithm: 'layered' });
    // slices of three: 3 + 3 + 1, a pause before the second and the third
    const c = core(many());
    const workers = heldWorkers();
    let pauses = 0;
    const writes: Array<{ keys: number; merge: string | undefined }> = [];
    const sliced = createAsyncArranger({
      store: c.store,
      execute: (id, args, options) => {
        if (id === 'layout.applyBoxes') writes.push({ keys: Object.keys((args as { boxes: object }).boxes).length, merge: options?.mergeKey });
        return c.execute(id, args, options?.mergeKey === undefined ? undefined : { mergeKey: options.mergeKey });
      },
      host: createLayoutHost(workers.spawn),
      lookup: lookupIn(c),
      slice: 3,
      pause: () => {
        pauses += 1;
        return Promise.resolve();
      },
    });
    const pending = sliced({ screenId: 's1', algorithm: 'layered' });
    await later();
    workers.release();
    expect(await pending).toMatchObject({ ok: true, value: { moved: 7 } });
    // one pause before the snapshot, one before each later slice
    expect(pauses).toBe(3);
    expect(writes.map((w) => w.keys)).toEqual([3, 3, 1]);
    expect(new Set(writes.map((w) => w.merge)).size).toBe(1);
    expect(writes[0]?.merge).toBeDefined();
    expect(boxesOf(c, ids)).toEqual(boxesOf(sync, ids));
    // one undo step takes all three slices back
    expect(c.store.history.undo().ok).toBe(true);
    expect(c.store.history.canUndo()).toBe(false);
    expect(boxesOf(c, ids)).toEqual(boxesOf(core(many()), ids));
    // an element of a later slice edited by a person while the first slice was written: the write stops there, and says how far it got
    const d = core(many());
    const held = heldWorkers();
    let stops = 0;
    const stopping = createAsyncArranger({
      store: d.store,
      execute: d.execute,
      host: createLayoutHost(held.spawn),
      lookup: lookupIn(d),
      slice: 3,
      pause: () => {
        stops += 1;
        // the first pause is before the snapshot; the second is between the slices, when a person edits an element of the next one
        if (stops === 2) d.execute('element.update', { id: 'u', fields: { transform: { x: 900, y: 900, w: 100, h: 50 } } });
        return Promise.resolve();
      },
    });
    const second = stopping({ screenId: 's1', algorithm: 'layered' });
    await later();
    held.release();
    expect(await second).toMatchObject({ ok: false, error: { code: 'LAYOUT_INPUT_INVALID' } });
    expect(boxesOf(d, ['u'])[0]).toEqual({ x: 900, y: 900, w: 100, h: 50 });
  });
});

describe('async arrange after an edit (FR-LAY-010)', () => {
  it('FR-LAY-010: with `amend` the written boxes join the undo entry of the edit before them; without it they are an entry of their own', async () => {
    for (const amend of [true, false]) {
      const c = core(three());
      const edit = () => c.execute('element.update', { id: 'a', fields: { transform: { x: 300, y: 300, w: 120, h: 50 } } });
      edit();
      c.store.history.seal();
      const edited = c.store.toDocument();
      const depth = c.store.history.undoDepth;
      const workers = heldWorkers();
      const pending = arranger(c, workers)({ screenId: 's1', algorithm: 'layered', ...(amend ? { amend: true } : {}) });
      await later();
      workers.release();
      expect(await pending).toMatchObject({ ok: true });
      expect(boxesOf(c, IDS)).not.toEqual(boxesOf(core(three()), IDS));
      expect(c.store.history.undoDepth).toBe(amend ? depth : depth + 1);
      expect(c.store.history.undo().ok).toBe(true);
      // one undo takes back the layout and, when it joined the edit, the edit with it
      expect(JSON.stringify(c.store.toDocument()) === JSON.stringify(edited)).toBe(!amend);
    }
  });

  it('FR-LAY-010: an amend is written at once, not in slices; a commit during the pause before the snapshot makes it an entry of its own', async () => {
    for (const commit of [false, true]) {
      const c = core(three());
      c.execute('element.update', { id: 'a', fields: { transform: { x: 300, y: 300, w: 120, h: 50 } } });
      c.store.history.seal();
      const workers = heldWorkers();
      const writes: unknown[] = [];
      const arrange = createAsyncArranger({
        store: c.store,
        execute: (id, args, options) => (writes.push(options), c.execute(id, args, options)),
        host: createLayoutHost(workers.spawn),
        lookup: lookupIn(c),
        slice: 1,
        pause: () => {
          if (commit && writes.length === 0) c.store.transact('other', (tx) => tx.patch('s1' as never, { name: 'Renamed' } as never));
          return Promise.resolve();
        },
      });
      const depth = c.store.history.undoDepth + (commit ? 1 : 0);
      const pending = arrange({ screenId: 's1', algorithm: 'layered', amend: true });
      await later();
      workers.release();
      expect(await pending).toMatchObject({ ok: true });
      expect(writes).toEqual(commit ? [{ mergeKey: expect.any(String) }, expect.anything(), expect.anything()] : [{ amend: true }]);
      expect(c.store.history.undoDepth).toBe(commit ? depth + 1 : depth);
    }
  });
});
