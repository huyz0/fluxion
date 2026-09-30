import { describe, expect, it } from 'vitest';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import type { ToolDispatcher } from './tools.js';
import { CONTEXT_MENU_EVENT } from './touch.js';
import { touchConsumer } from './touch-input.js';

const at = (phase: PointerPhase, id: number, x: number, y: number): PointerInfo => ({
  phase,
  pointerId: id,
  pointerType: 'touch',
  screen: { x, y },
  page: { x, y },
  button: 0,
  buttons: phase === 'up' ? 0 : 1,
  shift: false,
  alt: false,
  mod: false,
  pressure: 0.5,
  coalesced: [],
});

/** The fingers in front of a recording consumer and tools, with a timer the test fires. */
function setup() {
  const session = createSession('doc');
  session.camera.set({ x: 0, y: 0, z: 1 });
  const seen: string[] = [];
  const log: string[] = [];
  let pending: { fn: () => void; ms: number } | undefined;
  const inner = {
    deliver: (i: PointerInfo) => {
      seen.push(`${i.phase}:${i.pointerId}`);
      return true;
    },
    frameEnd: () => seen.push('frame'),
  };
  const tools = { cancel: () => log.push('cancel') } as unknown as ToolDispatcher;
  const menus: PointerInfo[] = [];
  const fingers = touchConsumer(inner, {
    session,
    tools,
    timer: (ms, fn) => {
      pending = { fn, ms };
      return () => {
        log.push('stop');
        pending = undefined;
      };
    },
    onLongPress: (i) => menus.push(i),
  });
  const fire = () => {
    const due = pending;
    pending = undefined;
    due?.fn();
  };
  return { session, seen, log, menus, fingers, fire, timer: () => pending };
}

describe('the canvas fingers (FR-EDT-019)', () => {
  it('FR-EDT-019: one finger passes through to the tools; mouse input untouched', () => {
    const { seen, fingers, timer, log } = setup();
    expect(fingers.deliver(at('down', 1, 10, 10))).toBe(true);
    expect([timer()?.ms, CONTEXT_MENU_EVENT]).toEqual([500, 'fx-contextmenu']);
    fingers.deliver(at('move', 1, 12, 10));
    // drifting within the slop keeps the press still; beyond it the long press is off
    expect(timer()).toBeDefined();
    fingers.deliver(at('move', 1, 30, 10));
    expect([timer(), log]).toEqual([undefined, ['stop']]);
    fingers.deliver(at('up', 1, 30, 10));
    fingers.frameEnd?.();
    // a mouse press passes straight through: no long press is timed for it
    fingers.deliver({ ...at('down', 7, 0, 0), pointerType: 'mouse' });
    expect([seen, timer()]).toEqual([['down:1', 'move:1', 'move:1', 'up:1', 'frame', 'down:7'], undefined]);
  });

  it('FR-EDT-019: a second finger cancels the tools, and two fingers pan and zoom until they lift', () => {
    const { session, seen, log, fingers } = setup();
    fingers.deliver(at('down', 1, 50, 100));
    expect(fingers.deliver(at('down', 2, 150, 100))).toBe(true);
    expect(log).toEqual(['stop', 'cancel']);
    fingers.deliver(at('move', 1, 0, 100));
    fingers.deliver(at('move', 2, 200, 100));
    expect(session.camera.get()).toEqual({ x: 50, y: 50, z: 2 });
    // a third finger joins nothing: the pinch goes on from where it began, even once that finger lifts
    expect(fingers.deliver(at('down', 3, 0, 0))).toBe(true);
    fingers.deliver(at('move', 2, 350, 100));
    expect(session.camera.get()).toEqual({ x: 50, y: 100 - 100 / 3.5, z: 3.5 });
    fingers.deliver(at('up', 3, 0, 0));
    fingers.deliver(at('move', 2, 200, 100));
    expect(session.camera.get()).toEqual({ x: 50, y: 50, z: 2 });
    // one of the pinch lifting ends it, and the other moves nothing
    fingers.deliver(at('up', 2, 200, 100));
    fingers.deliver(at('move', 1, 300, 300));
    expect(session.camera.get()).toEqual({ x: 50, y: 50, z: 2 });
    fingers.deliver(at('up', 1, 300, 300));
    // after all have lifted, a finger passes through again; an unknown finger's input is dropped
    fingers.deliver(at('down', 4, 1, 1));
    expect(fingers.deliver(at('move', 9, 1, 1))).toBeUndefined();
    expect(fingers.deliver(at('up', 9, 1, 1))).toBeUndefined();
    expect(seen).toEqual(['down:1', 'down:4']);
  });

  it('FR-EDT-019: after a pinch ends, fingers still down start nothing until all have lifted', () => {
    const { session, fingers } = setup();
    fingers.deliver(at('down', 1, 50, 100));
    fingers.deliver(at('down', 2, 150, 100));
    fingers.deliver(at('down', 3, 100, 200));
    fingers.deliver(at('up', 2, 150, 100));
    // fingers 1 and 3 remain; a fourth lands: no pinch among three
    fingers.deliver(at('down', 4, 100, 300));
    fingers.deliver(at('move', 1, 0, 0));
    fingers.deliver(at('move', 3, 400, 400));
    expect(session.camera.get()).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('FR-EDT-019: a finger held still asks for the context menu; what it does next is no tool`s', () => {
    const { seen, log, menus, fingers, fire, timer } = setup();
    fingers.deliver(at('down', 1, 40, 60));
    fire();
    expect([menus.map((m) => m.screen), log, timer()]).toEqual([[{ x: 40, y: 60 }], ['cancel'], undefined]);
    fingers.deliver(at('move', 1, 90, 90));
    fingers.deliver(at('up', 1, 90, 90));
    // a cancel lifts a finger too
    fingers.deliver(at('down', 2, 0, 0));
    fingers.deliver(at('cancel', 2, 0, 0));
    expect(seen).toEqual(['down:1', 'down:2', 'cancel:2']);
    expect(log).toEqual(['cancel', 'stop']);
  });
});
