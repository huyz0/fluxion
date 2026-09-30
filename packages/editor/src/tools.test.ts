import type { RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { handTool, registerBuiltinTools, selectTool } from './builtin-tools.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry, type KeyInfo, SELECT_TOOL, type Tool, type ToolCtx } from './tools.js';

const at = (phase: PointerPhase, x: number, y: number, button = 0): PointerInfo => ({
  phase,
  pointerId: 1,
  pointerType: 'mouse',
  screen: { x, y },
  page: { x, y },
  button,
  buttons: phase === 'up' ? 0 : 1,
  shift: false,
  alt: false,
  mod: false,
  pressure: 0.5,
  coalesced: [],
});
const key = (k: string, o: Partial<KeyInfo> = {}): KeyInfo => ({ key: k, shift: false, alt: false, mod: false, ...o });

/** A context whose hit-test finds `under` inside the box 0..100. */
function setup(under = 'shape1' as RecordId) {
  const session = createSession('doc');
  const log: string[] = [];
  const boxes: string[] = [];
  const ctx: ToolCtx = {
    session,
    hitTest: (p) => (p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100 ? under : undefined),
    elementsIn: (box, mode) => {
      boxes.push(`${mode} ${box.x},${box.y},${box.w},${box.h}`);
      return mode === 'contain' ? (['inside'] as RecordId[]) : (['inside', 'touched'] as RecordId[]);
    },
    allElements: () => ['one', 'two'] as RecordId[],
    execute: () => ({ ok: true, value: undefined }),
    seal: () => log.push('seal'),
  };
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  return { session, ctx, registry, log, boxes };
}

/** A tool that records what its states see. */
function recorder(log: string[]): Tool {
  const note =
    (what: string) =>
    (_ctx: ToolCtx, e?: PointerInfo | KeyInfo | unknown): undefined => {
      log.push(`${what}${e !== undefined && typeof e === 'object' && e !== null && 'phase' in e ? `:${(e as PointerInfo).phase}` : ''}`);
      return undefined;
    };
  return {
    id: 'rec',
    title: 'Recorder',
    shortcut: 'r',
    initial: 'a',
    states: {
      a: {
        id: 'a',
        onEnter: (_ctx, info) => log.push(`enter a ${String(info)}`),
        onExit: () => log.push('exit a'),
        onCancel: () => {
          log.push('cancel a');
          return undefined;
        },
        onPointerDown: () => ({ to: 'b', info: 'down' }),
        onKeyDown: (_ctx, e) => (e.key === 'x' ? { to: 'b', info: 'x' } : e.key === 'c' ? { to: 'c' } : undefined),
      },
      // cancelling c goes to b, not back to the start
      c: { id: 'c', onCancel: () => ({ to: 'b', info: 'from c' }) },
      b: {
        id: 'b',
        onEnter: (_ctx, info) => log.push(`enter b ${String(info)}`),
        onExit: () => log.push('exit b'),
        onPointerMove: note('move'),
        onPointerUp: () => ({ to: 'a' }),
      },
    },
  };
}

describe('tool state machine (FR-EDT-003, ADR-0028)', () => {
  it('FR-EDT-003: Esc returns any tool to select', () => {
    const { session, ctx, registry, log } = setup();
    registry.register('rec', recorder(log), 'test');
    const tools = createToolDispatcher(registry, ctx);
    for (const [id, tool] of registry.list()) {
      session.tool.set(id);
      expect(tools.current).toBe(`${id}.${tool.initial}`);
      expect(tools.key(key('Escape'))).toBe(true);
      expect([session.tool.get(), tools.current]).toEqual([SELECT_TOOL, 'select.idle']);
    }
    // in the middle of a gesture, Esc first ends it; a second Esc leaves the tool
    session.tool.set('hand');
    tools.pointer(at('down', 10, 10));
    expect(tools.current).toBe('hand.panning');
    tools.key(key('Escape'));
    expect([session.tool.get(), tools.current]).toEqual(['hand', 'hand.idle']);
    tools.key(key('Escape'));
    expect(tools.current).toBe('select.idle');
    // a state without an onCancel returns to its tool's start
    session.tool.set('rec');
    tools.pointer(at('down', 10, 10));
    expect(tools.current).toBe('rec.b');
    tools.key(key('Escape'));
    expect(tools.current).toBe('rec.a');
    // a state's own cancel decides where Esc goes
    tools.key(key('c'));
    tools.key(key('Escape'));
    expect(tools.current).toBe('rec.b');
  });

  it('FR-EDT-003: every input first starts the tool the session names', () => {
    const { session, ctx, registry, log } = setup();
    registry.register('rec', recorder(log), 'test');
    const keys = createToolDispatcher(registry, ctx);
    session.tool.set('rec');
    expect(keys.key(key('x'))).toBe(true);
    expect(log).toEqual(['enter a undefined', 'exit a', 'enter b x']);
    const pointers = createToolDispatcher(registry, ctx);
    session.tool.set('hand');
    pointers.pointer(at('down', 0, 0));
    session.tool.set('rec');
    log.length = 0;
    pointers.cancel();
    // the hand's gesture was left by starting the recorder, which the cancel then reaches at its start
    expect([log, pointers.current]).toEqual([['enter a undefined', 'cancel a'], 'rec.a']);
    // a shortcut starts its tool at once
    const shortcuts = createToolDispatcher(registry, ctx);
    session.tool.set(SELECT_TOOL);
    log.length = 0;
    shortcuts.key(key('r'));
    expect(log).toEqual(['enter a undefined']);
  });

  it('FR-EDT-003: without any tool registered, input goes nowhere', () => {
    const { ctx } = setup();
    const empty = createToolRegistry();
    expect(empty.name).toBe('tools');
    const tools = createToolDispatcher(empty, ctx);
    expect([tools.pointer(at('down', 0, 0)), tools.key(key('h')), tools.current, tools.list()]).toEqual([false, false, '.', []]);
    expect(tools.key(key('Escape'))).toBe(true);
  });

  it('FR-EDT-003: shortcuts switch tools, cancelling a gesture first; modified keys are no shortcuts', () => {
    const { session, ctx, registry, log } = setup();
    registry.register('rec', recorder(log), 'test');
    const tools = createToolDispatcher(registry, ctx);
    expect(tools.key(key('h'))).toBe(true);
    expect(session.tool.get()).toBe('hand');
    expect(tools.key(key('V', { shift: true }))).toBe(true);
    expect(session.tool.get()).toBe(SELECT_TOOL);
    for (const k of [key('h', { mod: true }), key('h', { alt: true }), key('q')]) expect(tools.key(k)).toBe(false);
    expect(session.tool.get()).toBe(SELECT_TOOL);
    session.tool.set('hand');
    tools.pointer(at('down', 0, 0));
    tools.key(key('v'));
    expect(tools.current).toBe('select.idle');
    // an unknown tool falls back to select
    session.tool.set('nope');
    expect(tools.current).toBe('select.idle');
  });

  it('FR-EDT-003: states see pointer and key input, enter and exit with transition info; cancel ends a gesture', () => {
    const { session, ctx, registry, log } = setup();
    registry.register('rec', recorder(log), 'test');
    const tools = createToolDispatcher(registry, ctx);
    session.tool.set('rec');
    expect(tools.pointer(at('move', 0, 0))).toBe(false);
    expect(tools.pointer(at('down', 0, 0))).toBe(true);
    expect(tools.pointer(at('move', 5, 0))).toBe(true);
    expect(tools.pointer(at('up', 5, 0))).toBe(true);
    expect(tools.key(key('x'))).toBe(true);
    expect(tools.key(key('y'))).toBe(false);
    // a cancelled pointer is a cancel
    expect(tools.pointer(at('cancel', 0, 0))).toBe(true);
    expect(tools.current).toBe('rec.b');
    tools.cancel();
    expect(log).toEqual(['enter a undefined', 'exit a', 'enter b down', 'move:move', 'exit b', 'enter a undefined', 'exit a', 'enter b x']);
    session.tool.set('hand');
    tools.pointer(at('down', 0, 0));
    tools.cancel();
    expect(tools.current).toBe('hand.idle');
  });
});

describe('built-in tools (FR-EDT-003)', () => {
  it('FR-EDT-003: select picks the topmost element under a primary click, or none, and tracks the hover', () => {
    const { session, ctx, registry } = setup('shape1' as RecordId);
    const tools = createToolDispatcher(registry, ctx);
    tools.pointer(at('move', 50, 50));
    expect(session.hover.get()).toBe('shape1');
    tools.pointer(at('move', 500, 50));
    expect(session.hover.get()).toBeUndefined();
    // changing tools forgets the hover
    tools.pointer(at('move', 50, 50));
    session.tool.set('hand');
    expect(tools.current).toBe('hand.idle');
    expect(session.hover.get()).toBeUndefined();
    session.tool.set(SELECT_TOOL);
    tools.pointer(at('down', 50, 50));
    expect([session.selection.get(), tools.current]).toEqual([['shape1'], 'select.pointing']);
    tools.pointer(at('up', 50, 50));
    expect(tools.current).toBe('select.idle');
    tools.pointer(at('down', 500, 50));
    tools.pointer(at('up', 500, 50));
    expect(session.selection.get()).toEqual([]);
    // a secondary click leaves the selection alone
    session.selection.set(['x' as RecordId]);
    expect(tools.pointer(at('down', 50, 50, 2))).toBe(true);
    expect([session.selection.get(), tools.current]).toEqual([['x'], 'select.idle']);
    tools.pointer(at('down', 50, 50));
    tools.cancel();
    expect(tools.current).toBe('select.idle');
    expect([selectTool().shortcut, handTool().shortcut, selectTool().title, handTool().title]).toEqual(['v', 'h', 'Select', 'Hand']);
    expect([registry.source('select'), registry.source('hand')]).toEqual(['editor', 'editor']);
  });

  it('FR-EDT-004: shift-click toggles; a press on a selected element keeps the selection; ctrl/cmd + A selects all', () => {
    const { session, ctx, registry } = setup('shape1' as RecordId);
    const tools = createToolDispatcher(registry, ctx);
    const shifted = (phase: PointerPhase, x: number, y: number) => ({ ...at(phase, x, y), shift: true });
    session.selection.set(['other' as RecordId]);
    tools.pointer(shifted('down', 50, 50));
    tools.pointer(shifted('up', 50, 50));
    expect(session.selection.get()).toEqual(['other', 'shape1']);
    tools.pointer(shifted('down', 50, 50));
    tools.pointer(shifted('up', 50, 50));
    expect(session.selection.get()).toEqual(['other']);
    // a shifted click on nothing keeps the selection
    tools.pointer(shifted('down', 500, 50));
    tools.pointer(shifted('up', 500, 50));
    expect(session.selection.get()).toEqual(['other']);
    // a press on an element already selected keeps the others (for a drag); released, the click picks it alone
    session.selection.set(['other' as RecordId, 'shape1' as RecordId]);
    tools.pointer(at('down', 50, 50));
    expect(session.selection.get()).toEqual(['other', 'shape1']);
    tools.pointer(at('up', 50, 50));
    expect(session.selection.get()).toEqual(['shape1']);
    // a click on an element not selected, then released, stays as it was set
    session.selection.set(['other' as RecordId]);
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('up', 50, 50));
    expect(session.selection.get()).toEqual(['shape1']);
    expect(session.marquee.get()).toBeUndefined();
    expect(tools.key(key('a', { mod: true }))).toBe(true);
    expect(session.selection.get()).toEqual(['one', 'two']);
    expect(tools.key(key('a'))).toBe(false);
    expect(tools.key(key('b', { mod: true }))).toBe(false);
    expect(tools.key(key('A', { mod: true, shift: true }))).toBe(true);
  });

  it('FR-EDT-004: a drag from empty canvas is a marquee: rightwards contains, leftwards touches; shift adds; Esc undoes it', () => {
    const { session, ctx, registry, boxes } = setup('shape1' as RecordId);
    const tools = createToolDispatcher(registry, ctx);
    session.selection.set(['old' as RecordId]);
    tools.pointer(at('down', 200, 200));
    expect(session.selection.get()).toEqual([]);
    // under 4 px it is still a click
    tools.pointer(at('move', 203, 200));
    expect([tools.current, session.marquee.get()]).toEqual(['select.pointing', undefined]);
    tools.pointer(at('move', 260, 240));
    expect(tools.current).toBe('select.brushing');
    expect(session.marquee.get()).toEqual({ x: 200, y: 200, w: 60, h: 40 });
    expect(session.selection.get()).toEqual(['inside']);
    tools.pointer(at('move', 150, 240));
    expect([session.marquee.get(), session.selection.get()]).toEqual([{ x: 150, y: 200, w: 50, h: 40 }, ['inside', 'touched']]);
    tools.pointer(at('up', 150, 240));
    expect([tools.current, session.marquee.get(), session.selection.get()]).toEqual(['select.idle', undefined, ['inside', 'touched']]);
    expect(boxes).toEqual(['contain 200,200,60,40', 'intersect 150,200,50,40']);
    // shift adds to what was selected
    session.selection.set(['old' as RecordId]);
    tools.pointer({ ...at('down', 200, 200), shift: true });
    tools.pointer({ ...at('move', 260, 240), shift: true });
    expect(session.selection.get()).toEqual(['old', 'inside']);
    tools.pointer(at('up', 260, 240));
    // Esc puts the selection back and drops the marquee
    session.selection.set(['old' as RecordId]);
    tools.pointer(at('down', 200, 200));
    tools.pointer(at('move', 260, 240));
    tools.key(key('Escape'));
    expect([tools.current, session.marquee.get(), session.selection.get()]).toEqual(['select.idle', undefined, ['old']]);
    // a press on an element does not start a marquee
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('move', 90, 90));
    expect(tools.current).toBe('select.pointing');
    tools.pointer(at('up', 90, 90));
  });

  it('FR-EDT-003: the hand drags the page with the pointer, with any button', () => {
    const { session, ctx, registry } = setup();
    const tools = createToolDispatcher(registry, ctx);
    session.tool.set('hand');
    session.camera.set({ x: 0, y: 0, z: 2 });
    tools.pointer(at('down', 10, 10, 1));
    tools.pointer(at('move', 30, 50));
    tools.pointer(at('move', 40, 50));
    expect(session.camera.get()).toEqual({ x: -15, y: -20, z: 2 });
    tools.pointer(at('up', 40, 50));
    tools.pointer(at('move', 100, 100));
    expect(session.camera.get()).toEqual({ x: -15, y: -20, z: 2 });
    // and again
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('move', 20, 0));
    expect(session.camera.get()).toEqual({ x: -25, y: -20, z: 2 });
  });
});
