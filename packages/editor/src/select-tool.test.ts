import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry, type KeyInfo } from './tools.js';

const at = (phase: PointerPhase, x: number, y: number, o: Partial<PointerInfo> = {}): PointerInfo => ({
  phase,
  pointerId: 1,
  pointerType: 'mouse',
  screen: { x, y },
  page: { x, y },
  button: 0,
  buttons: phase === 'up' ? 0 : 1,
  shift: false,
  alt: false,
  mod: false,
  pressure: 0.5,
  coalesced: [],
  ...o,
});
const key = (k: string, o: Partial<KeyInfo> = {}): KeyInfo => ({ key: k, shift: false, alt: false, mod: false, ...o });

/** Two boxes on a screen, the select tool over a real core, and a hit-test by boxes. */
function setup() {
  const b = documentBuilder({ seed: 150 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
  const c = b.rect(screen, { x: 200, y: 0, w: 100, h: 100 });
  const core = createCore(b.build());
  const session = createSession('doc');
  let n = 0;
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const place = (id: RecordId) => (core.store.get(id) as { transform: { x: number; y: number; w: number; h: number } } | undefined)?.transform;
  const tools = createToolDispatcher(registry, {
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => `copycopycopy${String(++n).padStart(4, '0')}` as RecordId,
    hitTest: (p) =>
      [...core.store.members('byScreen', screen)].reverse().find((id) => {
        const t = place(id);
        return t !== undefined && p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h;
      }),
    elementsIn: () => [],
    screen: undefined,
    allElements: () => [],
  });
  const xy = (id: RecordId) => [place(id)?.x, place(id)?.y];
  return { core, screen, session, tools, a, c, xy };
}

describe('resizing and rotating with the select tool (FR-EDT-004)', () => {
  it('FR-EDT-004: a handle of the selection resizes it, a drag being one undo step; Esc puts it back', () => {
    const { core, session, tools, a } = setup();
    const box = () => (core.store.get(a) as { transform: { x: number; y: number; w: number; h: number; rot?: number } }).transform;
    session.selection.set([a]);
    // the camera is at 100 %: the se handle is at the box's corner (100, 100)
    tools.pointer(at('down', 100, 100));
    expect(tools.current).toBe('select.resizing');
    tools.pointer(at('move', 150, 120));
    tools.pointer(at('move', 160, 130));
    tools.pointer(at('up', 160, 130));
    expect([tools.current, box()]).toEqual(['select.idle', { x: 0, y: 0, w: 160, h: 130, rot: 0 }]);
    expect(core.store.history.undoDepth).toBe(1);
    // the se handle is now at (160, 130): pressed, dragged about the centre, then Esc
    tools.pointer(at('down', 160, 130));
    tools.pointer(at('move', 200, 200, { alt: true }));
    expect(box().w).toBe(240);
    tools.key(key('Escape'));
    expect(tools.current).toBe('select.idle');
    expect(box()).toEqual({ x: 0, y: 0, w: 160, h: 130, rot: 0 });
    expect(core.store.history.undoDepth).toBe(1);
  });

  it('FR-EDT-019: a handle pressed beside it follows the pointer from there, not to it; a finger reaches further', () => {
    const { core, session, tools, a } = setup();
    const box = () => (core.store.get(a) as { transform: { x: number; y: number; w: number; h: number } }).transform;
    session.selection.set([a]);
    // 15 px right of the se handle (100, 100): out of a mouse's reach, within a finger's
    tools.pointer(at('down', 115, 100));
    expect(tools.current).toBe('select.pointing');
    tools.pointer(at('up', 115, 100));
    session.selection.set([a]);
    tools.pointer(at('down', 115, 100, { pointerType: 'touch' }));
    expect(tools.current).toBe('select.resizing');
    tools.pointer(at('move', 155, 110, { pointerType: 'touch' }));
    tools.pointer(at('up', 155, 110, { pointerType: 'touch' }));
    // the edge moved as far as the finger did (40, 10), not to it
    expect([box().w, +box().h.toFixed(9)]).toEqual([140, 110]);
  });

  it('FR-EDT-004: the rotate handle turns the selection about its centre, in 15° steps with shift', () => {
    const { core, session, tools, a, c } = setup();
    const rot = (id: RecordId) => (core.store.get(id) as { transform: { rot?: number } }).transform.rot;
    session.selection.set([a]);
    // the rotate handle sits 24 px above the top edge's middle (50, 0)
    tools.pointer(at('down', 50, -24));
    expect(tools.current).toBe('select.rotating');
    tools.pointer(at('move', 150, 52, { shift: true }));
    tools.pointer(at('up', 150, 52));
    expect(rot(a)).toBe(90);
    // two elements turn together about their shared frame's centre
    session.selection.set([a, c]);
    const frameTop = { x: 150, y: -24 };
    tools.pointer(at('down', frameTop.x, frameTop.y));
    tools.pointer(at('move', 300, 50, { shift: true }));
    tools.pointer(at('up', 300, 50));
    expect([rot(a), rot(c)]).toEqual([180, 90]);
    expect(core.store.history.undoDepth).toBe(2);
  });
});

describe('moving with the select tool (FR-EDT-005)', () => {
  it('FR-EDT-005: a drag moves the element under it with the pointer; the whole drag is one undo step', () => {
    const { core, session, tools, a, c, xy } = setup();
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('move', 60, 70));
    expect(tools.current).toBe('select.translating');
    expect([session.selection.get(), xy(a)]).toEqual([[a], [10, 20]]);
    tools.pointer(at('move', 80, 70));
    tools.pointer(at('up', 80, 70));
    expect([tools.current, xy(a), xy(c)]).toEqual(['select.idle', [30, 20], [200, 0]]);
    expect(core.store.history.undoDepth).toBe(1);
    core.store.history.undo();
    expect(xy(a)).toEqual([0, 0]);
    // a press on a selected element drags the whole selection
    session.selection.set([a, c]);
    tools.pointer(at('down', 250, 50));
    tools.pointer(at('move', 250, 90));
    tools.pointer(at('up', 250, 90));
    expect([session.selection.get(), xy(a), xy(c)]).toEqual([
      [a, c],
      [0, 40],
      [200, 40],
    ]);
  });

  it('FR-EDT-005: alt-drag moves copies, leaving the originals; undo takes the copies away', () => {
    const { core, screen, session, tools, a, xy } = setup();
    tools.pointer(at('down', 50, 50, { alt: true }));
    tools.pointer(at('move', 50, 150, { alt: true }));
    tools.pointer(at('up', 50, 150));
    const copy = 'copycopycopy0001' as RecordId;
    expect([session.selection.get(), xy(copy), xy(a)]).toEqual([[copy], [0, 100], [0, 0]]);
    expect(core.store.members('byScreen', screen).length).toBe(3);
    expect(core.store.history.undoDepth).toBe(1);
    core.store.history.undo();
    expect([core.store.has(copy), core.store.members('byScreen', screen).length]).toEqual([false, 2]);
  });

  it('FR-EDT-005: when the copies are refused, alt-drag moves the originals', () => {
    const { core, session, tools, a, xy } = setup();
    // a copy that is refused: its id clashes with an element already there
    core.store.transact('clash', (tx) => {
      tx.put({ ...(core.store.get(a) as object), id: 'copycopycopy0001', index: 'a9', transform: { x: 600, y: 600, w: 10, h: 10 } } as never);
    });
    tools.pointer(at('down', 50, 50, { alt: true }));
    tools.pointer(at('move', 50, 80, { alt: true }));
    tools.pointer(at('up', 50, 80));
    expect([session.selection.get(), xy(a)]).toEqual([[a], [0, 30]]);
  });

  it('FR-EDT-005: Esc during a drag puts the elements back, and during an alt-drag takes the copies away; no undo step is left', () => {
    const { core, screen, session, tools, a, xy } = setup();
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('move', 90, 90));
    expect(xy(a)).toEqual([40, 40]);
    tools.key(key('Escape'));
    expect([tools.current, xy(a), core.store.history.undoDepth]).toEqual(['select.idle', [0, 0], 0]);
    tools.pointer(at('down', 50, 50, { alt: true }));
    tools.pointer(at('move', 50, 150, { alt: true }));
    expect(core.store.members('byScreen', screen).length).toBe(3);
    tools.key(key('Escape'));
    expect([core.store.members('byScreen', screen).length, session.selection.get(), xy(a), core.store.history.undoDepth]).toEqual([2, [a], [0, 0], 0]);
    tools.pointer(at('up', 50, 150));
    // a click on nothing changes nothing
    const doc = core.store;
    const before = doc.toDocument();
    tools.pointer(at('down', 500, 500));
    tools.pointer(at('up', 500, 500));
    expect(doc.toDocument()).toEqual(before);
  });

  it('FR-EDT-004: a shift-press on a selected element drags the selection; a shift-click without a drag takes it out', () => {
    const { session, tools, a, c, xy } = setup();
    session.selection.set([a, c]);
    tools.pointer(at('down', 50, 50, { shift: true }));
    expect(session.selection.get()).toEqual([a, c]);
    tools.pointer(at('move', 50, 80, { shift: true }));
    tools.pointer(at('up', 50, 80));
    expect([session.selection.get(), xy(a), xy(c)]).toEqual([
      [a, c],
      [0, 30],
      [200, 30],
    ]);
    tools.pointer(at('down', 50, 50, { shift: true }));
    tools.pointer(at('up', 50, 50));
    expect(session.selection.get()).toEqual([c]);
  });

  it('FR-EDT-005: arrow keys nudge the selection 1 px, 10 px with shift, each one undo step', () => {
    const { core, session, tools, a, c, xy } = setup();
    expect(tools.key(key('ArrowRight'))).toBe(false);
    session.selection.set([a, c]);
    expect(tools.key(key('ArrowRight'))).toBe(true);
    tools.key(key('ArrowDown', { shift: true }));
    tools.key(key('ArrowLeft'));
    tools.key(key('ArrowUp'));
    expect([xy(a), xy(c)]).toEqual([
      [0, 9],
      [200, 9],
    ]);
    expect(core.store.history.undoDepth).toBe(4);
    tools.key(key('ArrowLeft', { shift: true }));
    tools.key(key('ArrowRight', { shift: true }));
    tools.key(key('ArrowRight', { shift: true }));
    expect(xy(c)).toEqual([210, 9]);
    // with ctrl/cmd or alt, arrows are not nudges
    expect([tools.key(key('ArrowRight', { mod: true })), tools.key(key('ArrowRight', { alt: true }))]).toEqual([false, false]);
    expect(xy(a)).toEqual([10, 9]);
  });
});
