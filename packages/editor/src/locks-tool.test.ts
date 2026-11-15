// FR-SHP-008: the select tool respects editing locks (M19.15). A position lock keeps an element still through a drag and an arrow
// nudge, a rotation lock through the rotate handle, a size lock through a resize handle; an aspect lock keeps the ratio as shift
// does; a selection lock keeps a click, a marquee and select-all from picking it (the layers panel still does).
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

type Box = { x: number; y: number; w: number; h: number; rot?: number };

/** Box a (0,0 100x100) holding `locks`, box c (200,0 100x100), the select tool over a real core. */
function setup(locks: Record<string, boolean>, snap = false) {
  const b = documentBuilder({ seed: 1915 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
  const c = b.rect(screen, { x: 200, y: 0, w: 100, h: 100 });
  const core = createCore(b.build());
  expect(core.execute('element.update', { id: a, fields: { locks } }).ok).toBe(true);
  core.store.history.seal();
  const session = createSession('doc');
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const box = (id: RecordId) => (core.store.get(id) as { transform: Box }).transform;
  const all = () => [...core.store.members('byScreen', screen)];
  const tools = createToolDispatcher(registry, {
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => 'copycopycopy0001' as RecordId,
    hitTest: (p) =>
      all()
        .reverse()
        .find((id) => {
          const t = box(id);
          return p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h;
        }),
    elementsIn: () => all(),
    // with the screen given, a drag and a resize snap (the session snaps by default)
    screen: snap ? screen : undefined,
    allElements: () => all(),
  });
  return { core, session, tools, a, c, box };
}

describe('locks in the select tool (FR-SHP-008)', () => {
  it('FR-SHP-008: a position-locked element does not move by drag or arrow nudge; an unlocked one beside it does', () => {
    const { session, tools, a, c, box } = setup({ position: true });
    session.selection.set([a, c]);
    tools.pointer(at('down', 250, 50));
    tools.pointer(at('move', 270, 60));
    tools.pointer(at('up', 270, 60));
    expect([box(a).x, box(c).x]).toEqual([0, 220]);
    press(tools, key('ArrowDown'));
    expect([box(a).y, box(c).y]).toEqual([0, 11]);
  });

  it('FR-SHP-008: a rotation lock keeps the turn; a size lock keeps the size; an aspect lock keeps the ratio', () => {
    const turned = setup({ rotation: true });
    turned.session.selection.set([turned.a]);
    // the rotate handle sits 24 px above the top edge's middle (50, 0)
    turned.tools.pointer(at('down', 50, -24));
    turned.tools.pointer(at('move', 150, 52, { shift: true }));
    turned.tools.pointer(at('up', 150, 52));
    expect(turned.box(turned.a).rot ?? 0).toBe(0);
    const sized = setup({ size: true });
    sized.session.selection.set([sized.a]);
    sized.tools.pointer(at('down', 100, 100));
    sized.tools.pointer(at('move', 160, 130));
    sized.tools.pointer(at('up', 160, 130));
    expect(sized.box(sized.a)).toMatchObject({ w: 100, h: 100 });
    const kept = setup({ aspect: true });
    kept.session.selection.set([kept.a]);
    kept.tools.pointer(at('down', 100, 100));
    kept.tools.pointer(at('move', 200, 130));
    kept.tools.pointer(at('up', 200, 130));
    const { w, h } = kept.box(kept.a);
    expect(w).toBe(h);
    expect(w).toBeGreaterThan(100);
  });

  it('FR-SHP-008: a selection-locked element is not picked by a click, a marquee or select-all', () => {
    const { session, tools, a, c } = setup({ select: true });
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('up', 50, 50));
    expect(session.selection.get()).toEqual([]);
    tools.pointer(at('down', -10, -10));
    tools.pointer(at('move', 400, 200));
    tools.pointer(at('up', 400, 200));
    expect(session.selection.get()).toEqual([c]);
    session.selection.set([]);
    press(tools, key('a', { mod: true }));
    expect(session.selection.get()).toEqual([c]);
  });

  it('FR-SHP-008: with snapping on, a locked element neither snaps with a drag of the others nor stops its own resize', () => {
    const dragged = setup({ position: true }, true);
    dragged.session.selection.set([dragged.a, dragged.c]);
    // a 6 px drag of c (past the drag threshold, inside the snap distance): were a's box snapped with it, its left edge would be pulled back
    dragged.tools.pointer(at('down', 250, 50));
    dragged.tools.pointer(at('move', 256, 50));
    dragged.tools.pointer(at('up', 256, 50));
    expect([dragged.box(dragged.a).x, dragged.box(dragged.c).x]).toEqual([0, 206]);
    const resized = setup({ position: true }, true);
    resized.session.selection.set([resized.a]);
    // the east handle 3 px out: the shape is no target of its own resize
    resized.tools.pointer(at('down', 100, 50));
    resized.tools.pointer(at('move', 103, 50));
    resized.tools.pointer(at('up', 103, 50));
    expect(resized.box(resized.a).w).toBe(103);
  });

  it('FR-SHP-008: a handle gesture on several elements leaves a position-locked one where it is (M19.15 r2 F1)', () => {
    const { session, tools, a, c, box } = setup({ position: true });
    session.selection.set([a, c]);
    // the frame of both spans 0..300: its rotate handle 24 px above the top edge's middle (150, 0), swept a quarter turn
    tools.pointer(at('down', 150, -24));
    tools.pointer(at('move', 324, 50, { shift: true }));
    tools.pointer(at('up', 324, 50));
    expect(box(a)).toMatchObject({ x: 0, y: 0, w: 100, h: 100 });
    expect(box(a).rot ?? 0).toBe(0);
    expect(box(c).rot).toBe(90);
  });
});
