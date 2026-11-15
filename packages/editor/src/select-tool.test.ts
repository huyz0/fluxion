import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { press } from './__fixtures__/keys.js';
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
    press(tools, key('Escape'));
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

/** A frame F (0,0 200x200) holding member m at its right edge, a group G (300,0) holding member n at its right edge, and a rect r. */
function framed() {
  const s = setup();
  const put = (r: Record<string, unknown>) => {
    const done = s.core.execute('element.createMany', { elements: [{ type: 'element', screenId: s.screen, ...r }] });
    if (!done.ok) throw new Error(JSON.stringify(done));
  };
  put({ id: 'frameframe01', kind: 'frame', index: 'a5', transform: { x: 0, y: 300, w: 200, h: 200, rot: 0 } });
  put({ id: 'membermember', kind: 'shape', defId: 'basic:rect', index: 'a0', parentId: 'frameframe01', transform: { x: 150, y: 350, w: 50, h: 50, rot: 0 } });
  put({ id: 'groupgroup01', kind: 'group', index: 'a6', transform: { x: 300, y: 300, w: 200, h: 200, rot: 0 } });
  put({ id: 'grpmember001', kind: 'shape', defId: 'basic:rect', index: 'a0', parentId: 'groupgroup01', transform: { x: 300, y: 300, w: 200, h: 200, rot: 0 } });
  const t = (id: string) => (s.core.store.get(id as RecordId) as { transform: { x: number; y: number; w: number; h: number }; parentId?: string }).transform;
  const parent = (id: string) => (s.core.store.get(id as RecordId) as { parentId?: string }).parentId;
  return { ...s, t, parent };
}

describe('frames under the select tool (FR-ARR-006, ADR-0052)', () => {
  it('FR-ARR-006: the resize handle on a selected frame leaves a member at its edge unchanged; a group resize still scales its member', () => {
    const s = framed();
    s.session.selection.set(['frameframe01' as RecordId]);
    // the frame's se handle at (200, 500), dragged in to (120, 450): the member at its right edge stays where it is
    s.tools.pointer(at('down', 200, 500));
    expect(s.tools.current).toBe('select.resizing');
    s.tools.pointer(at('move', 120, 450));
    s.tools.pointer(at('up', 120, 450));
    expect(s.t('frameframe01')).toMatchObject({ x: 0, y: 300, w: 120, h: 150 });
    expect(s.t('membermember')).toEqual({ x: 150, y: 350, w: 50, h: 50, rot: 0 });
    // the group's se handle at (500, 500), dragged to (400, 400): its member scales to half
    s.session.selection.set(['groupgroup01' as RecordId]);
    s.tools.pointer(at('down', 500, 500));
    s.tools.pointer(at('move', 400, 400));
    s.tools.pointer(at('up', 400, 400));
    expect(s.t('grpmember001')).toMatchObject({ x: 300, y: 300, w: 100, h: 100 });
  });

  it('FR-ARR-006: a group resize scales a frame inside it together with its own members', () => {
    const s = framed();
    const put = (r: Record<string, unknown>) => {
      const done = s.core.execute('element.createMany', { elements: [{ type: 'element', screenId: s.screen, ...r }] });
      if (!done.ok) throw new Error(JSON.stringify(done));
    };
    put({ id: 'grpframe0001', kind: 'frame', index: 'a1', parentId: 'groupgroup01', transform: { x: 300, y: 300, w: 100, h: 100, rot: 0 } });
    put({ id: 'grpfrmember1', kind: 'shape', defId: 'basic:rect', index: 'a0', parentId: 'grpframe0001', transform: { x: 350, y: 350, w: 50, h: 50, rot: 0 } });
    s.session.selection.set(['groupgroup01' as RecordId]);
    s.tools.pointer(at('down', 500, 500));
    s.tools.pointer(at('move', 400, 400));
    s.tools.pointer(at('up', 400, 400));
    expect(s.t('grpframe0001')).toMatchObject({ x: 300, y: 300, w: 50, h: 50 });
    expect(s.t('grpfrmember1')).toMatchObject({ x: 325, y: 325, w: 25, h: 25 });
  });

  it('FR-ARR-006: a drag that drops a shape inside a frame reparents it, and one undo restores its place and its parent', () => {
    const s = framed();
    const before = s.core.store.history.undoDepth;
    // the rect a (0,0 100x100) dragged down into the frame: its centre lands at (100, 400)
    s.tools.pointer(at('down', 50, 50));
    s.tools.pointer(at('move', 50, 200));
    s.tools.pointer(at('move', 100, 400));
    s.tools.pointer(at('up', 100, 400));
    expect([s.parent(s.a), s.xy(s.a)]).toEqual(['frameframe01', [50, 350]]);
    expect(s.core.store.history.undoDepth).toBe(before + 1);
    s.core.store.history.undo();
    expect([s.parent(s.a), s.xy(s.a)]).toEqual([undefined, [0, 0]]);
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
    press(tools, key('Escape'));
    expect([tools.current, xy(a), core.store.history.undoDepth]).toEqual(['select.idle', [0, 0], 0]);
    tools.pointer(at('down', 50, 50, { alt: true }));
    tools.pointer(at('move', 50, 150, { alt: true }));
    expect(core.store.members('byScreen', screen).length).toBe(3);
    press(tools, key('Escape'));
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
    expect(press(tools, key('ArrowRight'))).toBe(false);
    session.selection.set([a, c]);
    expect(press(tools, key('ArrowRight'))).toBe(true);
    press(tools, key('ArrowDown', { shift: true }));
    press(tools, key('ArrowLeft'));
    press(tools, key('ArrowUp'));
    expect([xy(a), xy(c)]).toEqual([
      [0, 9],
      [200, 9],
    ]);
    expect(core.store.history.undoDepth).toBe(4);
    press(tools, key('ArrowLeft', { shift: true }));
    press(tools, key('ArrowRight', { shift: true }));
    press(tools, key('ArrowRight', { shift: true }));
    expect(xy(c)).toEqual([210, 9]);
    // with ctrl/cmd or alt, arrows are not nudges
    expect([press(tools, key('ArrowRight', { mod: true })), press(tools, key('ArrowRight', { alt: true }))]).toEqual([false, false]);
    expect(xy(a)).toEqual([10, 9]);
  });

  it('FR-EDT-022: a drag, a nudge and a resize pin the element in the same undo step; undo and Esc leave it auto', () => {
    const { core, session, tools, a, c } = setup();
    const placement = (id: RecordId) => (core.store.get(id) as { placement?: string }).placement ?? 'auto';
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('move', 90, 90));
    tools.pointer(at('up', 90, 90));
    expect([placement(a), placement(c), core.store.history.undoDepth]).toEqual(['pinned', 'auto', 1]);
    core.store.history.undo();
    expect([placement(a), core.store.history.undoDepth]).toEqual(['auto', 0]);
    // Esc puts the placement back too, and leaves no step
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('move', 90, 90));
    press(tools, key('Escape'));
    tools.pointer(at('up', 90, 90));
    expect([placement(a), core.store.history.undoDepth]).toEqual(['auto', 0]);
    // a nudge pins the selection only
    session.selection.set([c]);
    press(tools, key('ArrowRight'));
    expect([placement(a), placement(c), core.store.history.undoDepth]).toEqual(['auto', 'pinned', 1]);
    core.store.history.undo();
    expect(placement(c)).toBe('auto');
  });

  it('FR-EDT-022: a resize or a turn cancelled with Esc leaves the element as it was: placement auto, no undo step', () => {
    const { core, session, tools, a } = setup();
    const placement = () => (core.store.get(a) as { placement?: string }).placement ?? 'auto';
    const box = () => (core.store.get(a) as { transform: unknown }).transform;
    const start = box();
    session.selection.set([a]);
    // the se handle at (100, 100): dragged, pinned while it runs, then Esc
    tools.pointer(at('down', 100, 100));
    expect(tools.current).toBe('select.resizing');
    tools.pointer(at('move', 150, 130));
    expect(placement()).toBe('pinned');
    press(tools, key('Escape'));
    tools.pointer(at('up', 150, 130));
    expect([tools.current, placement(), box(), core.store.history.undoDepth]).toEqual(['select.idle', 'auto', start, 0]);
    // the rotate handle 24 px above the top edge's middle (50, 0)
    tools.pointer(at('down', 50, -24));
    expect(tools.current).toBe('select.rotating');
    tools.pointer(at('move', 150, 52));
    expect(placement()).toBe('pinned');
    press(tools, key('Escape'));
    tools.pointer(at('up', 150, 52));
    expect([tools.current, placement(), box(), core.store.history.undoDepth]).toEqual(['select.idle', 'auto', start, 0]);
  });

  it('FR-EDT-022: a drag, a nudge, a resize and a turn by fractions write values of at most 2 decimals', () => {
    const { core, session, tools, a, c } = setup();
    const box = (id: RecordId) => (core.store.get(id) as { transform: { x: number; y: number; w: number; h: number; rot?: number } }).transform;
    // a drag of 10.004 units (snapping bypassed with the mod key would not matter: the grid and the other elements are far)
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('move', 50 + 10.004, 50 + 9.996));
    tools.pointer(at('up', 50 + 10.004, 50 + 9.996));
    expect(box(a)).toMatchObject({ x: 10, y: 10 });
    // a nudge of an element that holds float noise writes a round value
    core.store.transact('noise', (tx) => tx.patch(c, { transform: { x: 200.00000000000003, y: 0.1 + 0.2, w: 100, h: 100 } }));
    session.selection.set([c]);
    press(tools, key('ArrowRight'));
    expect(box(c)).toMatchObject({ x: 201, y: 0.3 });
    // a resize by a fraction: the se handle of a is at (110, 110)
    session.selection.set([a]);
    tools.pointer(at('down', 110, 110));
    tools.pointer(at('move', 110 + 10.004, 110 + 100 / 3));
    tools.pointer(at('up', 110 + 10.004, 110 + 100 / 3));
    expect(box(a)).toMatchObject({ x: 10, y: 10, w: 110, h: 133.33 });
    // a turn
    tools.pointer(at('down', 65, -14));
    tools.pointer(at('move', 150, 52));
    tools.pointer(at('up', 150, 52));
    const { rot, ...rest } = box(a);
    for (const n of [rot ?? 0, ...Object.values(rest)]) expect(Math.abs(n * 100 - Math.round(n * 100))).toBeLessThan(1e-9);
  });
});
