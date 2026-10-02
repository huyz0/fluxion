import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { press } from './__fixtures__/keys.js';
import { registerBuiltinTools } from './builtin-tools.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry } from './tools.js';

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

/** `a` (0,0 100x100) to drag beside `c` (300,200 100x100) on a screen of the default size, the select tool snapping. */
function setup() {
  const b = documentBuilder({ seed: 151 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
  const c = b.rect(screen, { x: 300, y: 200, w: 100, h: 100 });
  const core = createCore(b.build());
  const session = createSession('doc');
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const place = (id: RecordId) => (core.store.get(id) as { transform: { x: number; y: number } }).transform;
  const tools = createToolDispatcher(registry, {
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => 'copycopycopy0001' as RecordId,
    hitTest: (p) => (p.x >= 0 && p.x <= 100 + (place(a).x - 0) && p.y <= 100 + place(a).y ? a : undefined),
    elementsIn: () => [],
    screen,
    allElements: () => [],
  });
  const drag = (to: { x: number; y: number }, o: Partial<PointerInfo> = {}) => {
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('move', to.x, to.y, o));
  };
  return { core, session, tools, a, drag, xy: () => [place(a).x, place(a).y] };
}

describe('snapping while dragging with the select tool (FR-ARR-005)', () => {
  it('FR-ARR-005: a drag snaps to another element`s edge and shows the guide, which goes with the drag', () => {
    const { session, tools, drag, xy } = setup();
    // 297 is 3 from c's left edge at 300; the top is 5 above c's top (200): 195 -> 200
    drag({ x: 347, y: 245 });
    expect(xy()).toEqual([300, 200]);
    expect(session.guides.get().map((g) => `${g.axis}:${g.at}:${g.kind}`)).toEqual(expect.arrayContaining(['x:300:edge', 'y:200:edge']));
    tools.pointer(at('up', 347, 245));
    expect(session.guides.get()).toEqual([]);
  });

  it('FR-ARR-005: the screen`s edges are targets too', () => {
    const { drag, xy } = setup();
    drag({ x: 54, y: 52 });
    expect(xy()).toEqual([0, 0]);
  });

  it('FR-ARR-005: Alt after the press, Ctrl or Cmd, and the toggle all leave the drag unsnapped', () => {
    const alt = setup();
    alt.drag({ x: 347, y: 245 }, { alt: true });
    expect(alt.xy()).toEqual([297, 195]);
    const mod = setup();
    mod.drag({ x: 347, y: 245 }, { mod: true });
    expect(mod.xy()).toEqual([297, 195]);
    expect(mod.session.guides.get()).toEqual([]);
    const off = setup();
    off.session.snap.set(false);
    off.drag({ x: 347, y: 245 });
    expect(off.xy()).toEqual([297, 195]);
  });

  it('FR-ARR-005: Esc puts the element back and clears the guides', () => {
    const { session, tools, drag, xy } = setup();
    drag({ x: 347, y: 245 });
    press(tools, { key: 'Escape', shift: false, alt: false, mod: false });
    expect(xy()).toEqual([0, 0]);
    expect(session.guides.get()).toEqual([]);
  });
});
