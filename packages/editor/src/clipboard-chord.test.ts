import { describe, expect, it } from 'vitest';
import { CHORD_WAIT_MS, type ClipboardAction, chordAction, chordFallback, type Timers } from './clipboard-chord.js';

// FR-EDT-007, NFR-PORT-001: a clipboard chord that the browser raises no event for is done by the editor itself.
const key = (k: string, mods: Partial<Parameters<typeof chordAction>[0]> = {}) => ({
  key: k,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  ...mods,
});

/** A clock the test drives by hand. */
function fakeTimers() {
  const waiting = new Map<number, { at: number; fn: () => void }>();
  let now = 0;
  let next = 1;
  const timers: Timers = {
    set(fn, ms) {
      const id = next++;
      waiting.set(id, { at: now + ms, fn });
      return id;
    },
    clear(handle) {
      waiting.delete(handle as number);
    },
  };
  return {
    timers,
    pending: () => waiting.size,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...waiting]) {
        if (t.at > now) continue;
        waiting.delete(id);
        t.fn();
      }
    },
  };
}

describe('chordAction (FR-EDT-007)', () => {
  it('FR-EDT-007: names Ctrl or Cmd with C, X and V, in either case', () => {
    expect(chordAction(key('c'))).toBe('copy');
    expect(chordAction(key('X'))).toBe('cut');
    expect(chordAction(key('v', { ctrlKey: false, metaKey: true }))).toBe('paste');
  });

  it('FR-EDT-007: is not a chord without Ctrl or Cmd, with Shift or Alt, on another key, or on an auto-repeat', () => {
    expect(chordAction(key('c', { ctrlKey: false }))).toBeUndefined();
    expect(chordAction(key('v', { shiftKey: true }))).toBeUndefined();
    expect(chordAction(key('c', { altKey: true }))).toBeUndefined();
    expect(chordAction(key('a'))).toBeUndefined();
    expect(chordAction(key('c', { repeat: true }))).toBeUndefined();
  });
});

describe('chordFallback (FR-EDT-007, NFR-PORT-001)', () => {
  it('NFR-PORT-001: does the chord when no event answered within the wait', () => {
    const clock = fakeTimers();
    const done: ClipboardAction[] = [];
    chordFallback(clock.timers, (a) => done.push(a)).pressed('paste');
    clock.advance(CHORD_WAIT_MS - 1);
    expect(done).toEqual([]);
    clock.advance(1);
    expect(done).toEqual(['paste']);
    expect(clock.pending()).toBe(0);
  });

  it('FR-EDT-007: does nothing when the browser raised its event', () => {
    const clock = fakeTimers();
    const done: ClipboardAction[] = [];
    const fallback = chordFallback(clock.timers, (a) => done.push(a));
    fallback.pressed('copy');
    fallback.answered();
    clock.advance(10 * CHORD_WAIT_MS);
    expect(done).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  it('FR-EDT-007: a chord still waiting when the next is pressed is done first, then the next after its own wait', () => {
    const clock = fakeTimers();
    const done: ClipboardAction[] = [];
    const fallback = chordFallback(clock.timers, (a) => done.push(a));
    fallback.pressed('copy');
    clock.advance(CHORD_WAIT_MS / 2);
    fallback.pressed('paste');
    expect(done).toEqual(['copy']);
    clock.advance(CHORD_WAIT_MS);
    expect(done).toEqual(['copy', 'paste']);
  });

  it('FR-EDT-007: cancel forgets a waiting chord, and answering with none waiting is harmless', () => {
    const clock = fakeTimers();
    const done: ClipboardAction[] = [];
    const fallback = chordFallback(clock.timers, (a) => done.push(a));
    fallback.answered();
    fallback.pressed('cut');
    fallback.cancel();
    clock.advance(10 * CHORD_WAIT_MS);
    expect(done).toEqual([]);
  });
});
