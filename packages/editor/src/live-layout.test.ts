// FR-LAY-010: the live-layout reactor re-lays a live frame out after an edit to its children, as part of the edit's undo entry (ADR-0046).
import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { type LiveFrame, type LiveLayoutRun, type LivePlan, startLiveLayout } from './live-layout.js';

const GROUP = 'LiveGroup0000001' as RecordId;
const INNER = 'LiveGroup0000002' as RecordId;

/** A core with a live group of two rects, and a reactor whose "layout" moves the first child to x = 500 and records the frames it laid out. */
function setup(live: boolean | 'none' = true) {
  const b = documentBuilder({ seed: 1710 });
  const screen = b.screen({ size: { w: 1000, h: 600 } });
  const a = b.rect(screen, { x: 20, y: 100, w: 100, h: 50 });
  const c = b.rect(screen, { x: 200, y: 300, w: 100, h: 50 });
  const core = createCore(b.build());
  core.execute('element.group', { ids: [a, c], groupId: GROUP });
  if (live !== 'none') core.store.transact('live', (tx) => tx.patch(GROUP, { layout: { type: 'stack', live } } as never));
  core.store.history.seal();
  const base = core.store.history.undoDepth;
  const tasks: Array<() => void> = [];
  const laid: RecordId[] = [];
  const layout = (frame: LiveFrame): LivePlan => ({
    apply: (amend) => {
      laid.push(frame.containerId);
      core.store.transact('layout.live', (tx) => tx.patch(a, { transform: { x: 500, y: 100, w: 100, h: 50 } } as never), {
        origin: 'system',
        ...(amend ? { amend: true } : {}),
      });
    },
  });
  const make = (run: LiveLayoutRun = layout) => startLiveLayout({ store: core.store, run, schedule: (t) => void tasks.push(t) });
  const flush = () => tasks.splice(0).forEach((t) => void t());
  const resize = (w: number, options = {}) => core.execute('element.update', { id: c, fields: { transform: { x: 200, y: 300, w, h: 50 } } }, options);
  const xOf = (id: RecordId) => (core.store.get(id) as { transform: { x: number } }).transform.x;
  return { core, base, screen, a, c, laid, tasks, make, flush, resize, xOf };
}

describe('live layout frames (FR-LAY-010, ADR-0046)', () => {
  it('FR-LAY-010: WHEN a child of a live frame is resized THE SYSTEM SHALL re-lay the frame out in the same undo entry', () => {
    const t = setup();
    t.make();
    const before = t.core.store.toDocument();
    expect(t.resize(120).ok).toBe(true);
    // nothing is laid out inside the commit: the layout waits for the task
    expect(t.laid).toEqual([]);
    t.flush();
    expect(t.laid).toEqual([GROUP]);
    expect(t.xOf(t.a)).toBe(500);
    expect(t.core.store.history.undoDepth).toBe(t.base + 1);
    expect(t.core.store.history.undo().ok).toBe(true);
    expect(t.core.store.toDocument()).toEqual(before);
  });

  it('FR-LAY-010: a frame that is not live, or has no layout, is left alone', () => {
    for (const live of [false, 'none'] as const) {
      const t = setup(live);
      t.make();
      t.resize(120);
      expect(t.tasks).toEqual([]);
      expect(t.laid).toEqual([]);
    }
  });

  it('FR-LAY-010: a move without a resize does not re-lay the frame out', () => {
    const t = setup();
    t.make();
    t.core.execute('element.update', { id: t.c, fields: { transform: { x: 250, y: 300, w: 100, h: 50 } } });
    expect(t.tasks).toEqual([]);
  });

  it('FR-LAY-010: a subscriber registered after the reactor receives the edit before the re-layout', () => {
    const t = setup();
    t.make();
    const seen: string[] = [];
    t.core.store.subscribe((_diff, meta) => void seen.push(meta.label));
    t.resize(120);
    t.flush();
    expect(seen).toEqual(['element.update', 'layout.live']);
  });

  it('FR-LAY-010: the reactor ignores undo, redo and its own commits', () => {
    const t = setup();
    t.make();
    t.resize(120);
    t.flush();
    t.laid.length = 0;
    t.core.store.history.undo();
    t.core.store.history.redo();
    expect(t.tasks).toEqual([]);
    expect(t.laid).toEqual([]);
  });

  it('FR-LAY-010: two edits in one task share one re-layout, which amends the last; the edit of the next task is a step of its own', () => {
    const t = setup();
    t.make();
    t.resize(120);
    t.resize(130);
    t.flush();
    expect(t.laid).toEqual([GROUP]);
    // two edits, two entries; the one re-layout amended the last
    expect(t.core.store.history.undoDepth).toBe(t.base + 2);
    t.core.store.history.seal();
    t.resize(140);
    t.flush();
    expect(t.laid).toEqual([GROUP, GROUP]);
    expect(t.core.store.history.undoDepth).toBe(t.base + 3);
  });

  it('FR-LAY-010: frames are laid out innermost first', () => {
    const inner = documentBuilder({ seed: 1711 });
    const screen = inner.screen({ size: { w: 1000, h: 600 } });
    const x = inner.rect(screen, { x: 0, y: 0, w: 50, h: 50 });
    const y = inner.rect(screen, { x: 100, y: 0, w: 50, h: 50 });
    const z = inner.rect(screen, { x: 200, y: 0, w: 50, h: 50 });
    const core = createCore(inner.build());
    core.execute('element.group', { ids: [x, y], groupId: INNER });
    core.execute('element.group', { ids: [INNER, z], groupId: GROUP });
    core.store.transact('live', (tx) => {
      tx.patch(INNER, { layout: { type: 'stack', live: true } } as never);
      tx.patch(GROUP, { layout: { type: 'stack', live: true } } as never);
    });
    const laid: RecordId[] = [];
    const tasks: Array<() => void> = [];
    startLiveLayout({ store: core.store, run: (f) => ({ apply: () => void laid.push(f.containerId) }), schedule: (task) => void tasks.push(task) });
    core.execute('element.update', { id: x, fields: { transform: { x: 0, y: 0, w: 60, h: 50 } } });
    // the inner group's child changed, and so did the outer group's member (the inner group's box): both are dirty, the inner first
    core.execute('element.update', { id: INNER, fields: { transform: { x: 0, y: 0, w: 400, h: 50 } } });
    tasks.splice(0).forEach((task) => void task());
    expect(laid).toEqual([INNER, GROUP]);
  });

  it('FR-LAY-010: a deferred layout with a commit in between is its own entry, never amended into the later one', async () => {
    const t = setup();
    const release = deferred(t);
    t.resize(120);
    t.flush();
    t.core.store.history.seal();
    // a different, later edit lands before the layout resolves
    t.core.execute('element.update', { id: t.c, fields: { name: 'later' } });
    release();
    await Promise.resolve();
    await Promise.resolve();
    // entries: the resize, the later edit, the layout as its own system entry
    expect(t.core.store.history.undoDepth).toBe(t.base + 3);
    t.core.store.history.undo();
    expect(t.xOf(t.a)).not.toBe(500);
    expect((t.core.store.get(t.c) as { name?: string }).name).toBe('later');
  });

  it('FR-LAY-010: a deferred layout is dropped when its frame was edited again meanwhile', async () => {
    const t = setup();
    const release = deferred(t);
    t.resize(120);
    t.flush();
    t.resize(130);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.xOf(t.a)).toBe(20);
  });

  it('FR-LAY-010: a deferred layout is dropped when its frame was dirtied again, even after the next flush and in any resolve order', async () => {
    const t = setup();
    const holds: Array<(plan: LivePlan) => void> = [];
    t.make(() => new Promise<LivePlan>((resolve) => void holds.push(resolve)));
    t.resize(120);
    t.flush();
    t.resize(130);
    t.flush();
    const depth = t.core.store.history.undoDepth;
    // the newer layout resolves first, then the stale one
    holds[1]?.({ apply: (amend) => writeLayout(t, amend, 500) });
    holds[0]?.({ apply: (amend) => writeLayout(t, amend, 300) });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.xOf(t.a)).toBe(500);
    // the newer one was dispatched after the second edit with nothing in between: it amended
    expect(t.core.store.history.undoDepth).toBe(depth);
  });

  it('FR-LAY-010: a deferred layout is dropped when the edit it follows is undone before it resolves, and the edit can be redone', async () => {
    const t = setup();
    const release = deferred(t);
    t.resize(120);
    t.flush();
    t.core.store.history.undo();
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.xOf(t.a)).toBe(20);
    expect(t.core.store.history.redoDepth).toBe(1);
  });

  it('FR-LAY-010: deferred layouts of nested frames from one flush all amend the edit', async () => {
    const b = documentBuilder({ seed: 1712 });
    const screen = b.screen({ size: { w: 1000, h: 600 } });
    const x = b.rect(screen, { x: 0, y: 0, w: 50, h: 50 });
    const y = b.rect(screen, { x: 100, y: 0, w: 50, h: 50 });
    const z = b.rect(screen, { x: 200, y: 0, w: 50, h: 50 });
    const core = createCore(b.build());
    core.execute('element.group', { ids: [x, y], groupId: INNER });
    core.execute('element.group', { ids: [INNER, z], groupId: GROUP });
    core.store.transact('live', (tx) => {
      tx.patch(INNER, { layout: { type: 'stack', live: true } } as never);
      tx.patch(GROUP, { layout: { type: 'stack', live: true } } as never);
    });
    core.store.history.seal();
    const holds: Array<() => void> = [];
    const tasks: Array<() => void> = [];
    const run = (f: LiveFrame) =>
      new Promise<LivePlan>(
        (resolve) =>
          void holds.push(() =>
            resolve({
              apply: (amend) =>
                void core.store.transact('layout.live', (tx) => tx.patch(f.containerId, { name: `laid ${f.containerId}` } as never), {
                  origin: 'system',
                  ...(amend ? { amend: true } : {}),
                }),
            }),
          ),
      );
    startLiveLayout({ store: core.store, run, schedule: (task) => void tasks.push(task) });
    const base = core.store.history.undoDepth;
    core.execute('element.update', { id: x, fields: { transform: { x: 0, y: 0, w: 60, h: 50 } } });
    core.execute('element.update', { id: INNER, fields: { transform: { x: 0, y: 0, w: 400, h: 50 } } });
    tasks.splice(0).forEach((task) => void task());
    for (const release of holds) {
      release();
      await Promise.resolve();
      await Promise.resolve();
    }
    // two edits, and both re-layouts amended the last of them
    expect(core.store.history.undoDepth).toBe(base + 2);
    expect((core.store.get(GROUP) as { name?: string }).name).toBe(`laid ${GROUP}`);
  });

  it('FR-LAY-010: stopping the reactor ends it', () => {
    const t = setup();
    const stop = t.make();
    stop();
    t.resize(120);
    expect(t.tasks).toEqual([]);
  });
});

/** Start a reactor whose layout resolves when the returned function is called. */
function deferred(t: ReturnType<typeof setup>): () => void {
  const hold: { resolve?: (plan: LivePlan) => void } = {};
  t.make(() => new Promise<LivePlan>((resolve) => void Object.assign(hold, { resolve })));
  return () => hold.resolve?.({ apply: (amend) => writeLayout(t, amend) });
}

/** Write the test layout: the first child to `x` (500). */
function writeLayout(t: ReturnType<typeof setup>, amend: boolean, x = 500): void {
  t.core.store.transact('layout.live', (tx) => tx.patch(t.a, { transform: { x, y: 100, w: 100, h: 50 } } as never), {
    origin: 'system',
    ...(amend ? { amend: true } : {}),
  });
}

describe('live layout frames, incremental and in the worker (FR-LAY-006, FR-LAY-010)', () => {
  /** A reactor over `t`'s store that records what the default run does: the commands it executes and the requests it sends to the port. */
  function defaults(
    t: ReturnType<typeof setup>,
    type: string,
    children = 2,
    answer: (request: unknown) => Promise<{ ok: boolean }> = () => Promise.resolve({ ok: true }),
  ) {
    t.core.store.transact('live', (tx) => tx.patch(GROUP, { layout: { type, live: true } } as never));
    const store = {
      subscribe: t.core.store.subscribe.bind(t.core.store),
      get: t.core.store.get.bind(t.core.store),
      members: () => Array.from({ length: children }, (_, i) => `m${i}` as RecordId),
    };
    const commands: unknown[][] = [];
    const requests: unknown[] = [];
    const execute = ((...args: unknown[]) => void commands.push(args)) as never;
    const arrange = (request: unknown) => {
      requests.push(request);
      return answer(request);
    };
    startLiveLayout({ store, execute, arrange, schedule: (task) => void t.tasks.push(task) });
    return { commands, requests };
  }

  it('FR-LAY-007: worker layouts are sent one at a time; one whose frame was dirtied again is not retried, and the newer one joins its own edit', async () => {
    const t = setup();
    const held: Array<(done: { ok: boolean }) => void> = [];
    const { requests } = defaults(t, 'layouts-elk:layered', 2, () => new Promise((resolve) => void held.push(resolve)));
    t.resize(120);
    t.flush();
    await settled();
    t.resize(130);
    t.flush();
    await settled();
    // the second waits for the first
    expect(requests).toHaveLength(1);
    held[0]?.({ ok: false });
    await settled();
    expect(requests).toEqual([
      { screenId: t.screen, scope: { containerId: GROUP }, changed: [t.c], amend: true },
      { screenId: t.screen, scope: { containerId: GROUP }, changed: [t.c], amend: true },
    ]);
  });

  it('FR-LAY-010: a worker layout dropped by the arranger is sent once more as an entry of its own; a commit before it is sent stops the amend', async () => {
    const t = setup();
    let calls = 0;
    const { requests } = defaults(t, 'layouts-elk:layered', 2, () => {
      calls += 1;
      return Promise.resolve({ ok: calls > 1 });
    });
    t.resize(120);
    t.flush();
    await settled();
    expect(requests).toEqual([
      { screenId: t.screen, scope: { containerId: GROUP }, changed: [t.c], amend: true },
      { screenId: t.screen, scope: { containerId: GROUP }, changed: [t.c] },
    ]);
    const u = setup();
    const late = defaults(u, 'layouts-elk:layered');
    u.resize(120);
    u.flush();
    // a person's commit lands before the chain sends the frame: the layout no longer follows the edit directly
    u.core.store.transact('other', (tx) => tx.patch(u.screen, { name: 'Renamed' } as never));
    await settled();
    expect(late.requests).toEqual([{ screenId: u.screen, scope: { containerId: GROUP }, changed: [u.c] }]);
  });

  it('FR-LAY-006: the frame handed to the layout names the children that changed, merged over the edits since the last layout', () => {
    const t = setup();
    const frames: LiveFrame[] = [];
    t.make((frame) => (frames.push(frame), { apply: () => undefined }));
    t.resize(120);
    t.resize(130);
    t.flush();
    expect(frames).toEqual([{ containerId: GROUP, screenId: t.screen, changed: [t.c] }]);
  });

  it('FR-LAY-006: the default run tells layout.arrange which children changed, and joins the undo entry of the edit', () => {
    const t = setup();
    const { commands, requests } = defaults(t, 'stack');
    t.resize(120);
    t.flush();
    expect(requests).toEqual([]);
    expect(commands).toEqual([['layout.arrange', { screenId: t.screen, scope: { containerId: GROUP }, changed: [t.c] }, { origin: 'system', amend: true }]]);
  });

  it('FR-LAY-007: an ELK layout, or a force layout of more than 200 children, is laid out through the worker port; a small force layout is not', async () => {
    const request = (t: ReturnType<typeof setup>) => ({ screenId: t.screen, scope: { containerId: GROUP }, changed: [t.c], amend: true });
    for (const [type, children, worker] of [
      ['layouts-elk:layered', 2, true],
      ['force', 201, true],
      ['force', 200, false],
      ['tree', 500, false],
    ] as const) {
      const t = setup();
      const { commands, requests } = defaults(t, type, children);
      t.resize(120);
      t.flush();
      // the worker path sends its frames one at a time, from a promise chain
      await settled();
      expect(requests).toEqual(worker ? [request(t)] : []);
      expect(commands).toHaveLength(worker ? 0 : 1);
    }
  });
});

/** A few turns of the microtask queue: the worker path's chain has sent what it holds. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}
