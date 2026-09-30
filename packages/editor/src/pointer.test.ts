import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { beginGesture, createPointerPipeline, type FrameScheduler, type PointerInfo, type PointerPhase, pointerInfo, type RawPointer } from './pointer.js';

/** A scheduler the test runs by hand: `frame()` runs what was scheduled, as a browser frame would. */
function manualFrames() {
  let pending: (() => void) | undefined;
  let scheduled = 0;
  const schedule: FrameScheduler = (cb) => {
    scheduled += 1;
    pending = cb;
    return () => {
      if (pending === cb) pending = undefined;
    };
  };
  const frame = () => {
    const cb = pending;
    pending = undefined;
    cb?.();
  };
  return { schedule, frame, scheduled: () => scheduled, pending: () => pending !== undefined };
}

const raw = (x: number, y: number, o: Partial<RawPointer> = {}): RawPointer => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  pointerType: 'mouse',
  button: 0,
  buttons: 1,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  pressure: 0.5,
  ...o,
});
const origin = { x: 10, y: 20 };
const camera = { x: 100, y: 50, z: 2 };
const info = (phase: PointerPhase, x: number, y: number, o: Partial<RawPointer> = {}) => pointerInfo(phase, raw(x, y, o), origin, camera);

describe('pointer pipeline (FR-EDT-003, ADR-0028)', () => {
  it('FR-EDT-003: a pointer event becomes canvas and page points through the camera, with its modifiers', () => {
    const p = info('down', 30, 60, { shiftKey: true, metaKey: true, pressure: 0.7, pointerType: 'pen', pointerId: 4, button: 2, buttons: 2 });
    expect(p).toEqual({
      phase: 'down',
      pointerId: 4,
      pointerType: 'pen',
      screen: { x: 20, y: 40 },
      page: { x: 110, y: 70 },
      button: 2,
      buttons: 2,
      shift: true,
      alt: false,
      mod: true,
      pressure: 0.7,
      coalesced: [],
    });
    expect(info('move', 0, 0, { ctrlKey: true, altKey: true })).toMatchObject({ mod: true, alt: true, shift: false });
    expect(info('move', 0, 0).mod).toBe(false);
  });

  it('FR-EDT-003: moves wait for the frame and arrive once per pointer, the latest carrying the ones it stands for', () => {
    const f = manualFrames();
    const got: PointerInfo[] = [];
    const ends: number[] = [];
    const pipe = createPointerPipeline(
      f.schedule,
      (i) => {
        got.push(i);
        return undefined;
      },
      () => ends.push(got.length),
    );
    const moves = [info('move', 1, 1), info('move', 2, 2), info('move', 3, 3)];
    for (const m of moves) pipe.push(m);
    pipe.push(info('move', 9, 9, { pointerId: 2 }));
    expect([got.length, f.scheduled()]).toEqual([0, 1]);
    f.frame();
    expect(got.map((g) => [g.pointerId, g.screen.x, g.coalesced.length])).toEqual([
      [1, -7, 3],
      [2, -1, 1],
    ]);
    expect(got[0]?.coalesced).toEqual(moves);
    expect(ends).toEqual([2]);
    // a down flushes (and ends) the frame before it goes
    pipe.push(info('down', 0, 0));
    expect(ends).toEqual([2, 2]);
    // an empty frame delivers nothing
    f.frame();
    expect(got.length).toBe(3);
  });

  it('FR-EDT-003: a down, up or cancel flushes the waiting moves first, then goes at once', () => {
    const f = manualFrames();
    const got: string[] = [];
    const pipe = createPointerPipeline(f.schedule, (i) => {
      got.push(`${i.phase}:${i.screen.x}`);
      return i.phase === 'down';
    });
    expect(pipe.push(info('down', 10, 0))).toBe(true);
    expect(pipe.push(info('move', 10, 0))).toBeUndefined();
    pipe.push(info('move', 11, 0));
    pipe.push(info('move', 12, 0));
    expect(pipe.push(info('up', 13, 0))).toBe(false);
    expect(got).toEqual(['down:0', 'move:2', 'up:3']);
    // deliver's answer comes back for a down, up or cancel
    // the flush cancelled the frame it had scheduled
    expect(f.pending()).toBe(false);
    pipe.push(info('cancel', 14, 0));
    expect(got.at(-1)).toBe('cancel:4');
  });

  it('FR-EDT-003: flush delivers now; dispose drops the waiting moves and the frame', () => {
    const f = manualFrames();
    const got: PointerInfo[] = [];
    const pipe = createPointerPipeline(f.schedule, (i) => {
      got.push(i);
      return undefined;
    });
    pipe.push(info('move', 1, 1));
    pipe.flush();
    expect([got.length, f.pending()]).toEqual([1, false]);
    pipe.push(info('move', 2, 2));
    pipe.dispose();
    expect(f.pending()).toBe(false);
    f.frame();
    pipe.flush();
    expect(got.length).toBe(1);
    // a disposed pipeline without a frame still disposes cleanly
    pipe.dispose();
  });

  it('FR-EDT-003: a drag stream commits at most one store diff per frame', () => {
    const b = documentBuilder({ seed: 90 });
    const screen = b.screen();
    const rect = b.rect(screen, { x: 0, y: 0 });
    const core = createCore(b.build());
    const diffs: string[] = [];
    core.store.subscribe((_diff, meta) => diffs.push(meta.mergeKey ?? ''));
    const f = manualFrames();
    const seal = () => core.store.history.seal();
    const x = () => (core.store.get(rect) as { transform: { x: number } }).transform.x;
    const moveTo = (px: number, py: number) => ({ id: rect, fields: { transform: { x: px, y: py, w: 160, h: 80 } } });
    const gesture = beginGesture(core.execute, seal);
    // the tool sets the frame's command on every delivered move, twice to show a frame keeps the latest
    const pipe = createPointerPipeline(
      f.schedule,
      (i) => {
        if (i.phase !== 'move') return undefined;
        gesture.update('element.update', moveTo(i.page.x, 0));
        gesture.update('element.update', moveTo(i.page.x, i.page.y));
        return undefined;
      },
      () => gesture.commit(),
    );
    for (let frame = 0; frame < 5; frame++) {
      for (let k = 0; k < 10; k++) pipe.push(info('move', 10 + frame * 10 + k, 20));
      f.frame();
      expect(diffs.length).toBe(frame + 1);
    }
    expect(diffs.every((k) => k === gesture.mergeKey)).toBe(true);
    expect(gesture.mergeKey).toMatch(/^gesture:\d+$/);
    // the last frame's latest move: page (10 + 49 - 10) / 2 + 100, (20 - 20) / 2 + 50
    expect(core.store.get(rect)).toMatchObject({ transform: { x: 124.5, y: 50 } });
    expect(gesture.end()).toBeUndefined();
    // the whole drag is one undo step
    expect(core.store.history.undoDepth).toBe(1);
    // sealed: a late command of the ended gesture is a step of its own, not part of the drag
    gesture.update('element.update', moveTo(1, 1));
    expect(gesture.end()?.ok).toBe(true);
    expect(core.store.history.undoDepth).toBe(2);
    core.store.history.undo();
    // the next gesture has its own key; a rejected frame changes nothing and the gesture goes on
    const next = beginGesture(core.execute, seal);
    expect(next.mergeKey).not.toBe(gesture.mergeKey);
    next.update('element.update', { id: 'missing', fields: {} });
    expect(next.commit()?.ok).toBe(false);
    next.update('element.update', moveTo(7, 7));
    expect(next.end()?.ok).toBe(true);
    expect([x(), core.store.history.undoDepth]).toEqual([7, 2]);
    // a frame without a command commits nothing
    const committed = diffs.length;
    const idle = beginGesture(core.execute, seal);
    expect(idle.commit()).toBeUndefined();
    idle.end();
    expect([diffs.length, core.store.history.undoDepth]).toEqual([committed, 2]);
    core.store.history.undo();
    core.store.history.undo();
    expect(x()).toBe(0);
  });
});
