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
