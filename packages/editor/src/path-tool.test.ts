import { createCore } from '@fluxion/core';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { press } from './__fixtures__/keys.js';
import { registerBuiltinTools } from './builtin-tools.js';
import { FREEHAND_STEP_PX, MAX_PATH_POINTS, pathBox } from './path-tool.js';
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
const key = (k: string): KeyInfo => ({ key: k, shift: false, alt: false, mod: false });

function setup() {
  const b = documentBuilder({ seed: 183 });
  const screen = b.screen();
  const core = createCore(b.build());
  const session = createSession('doc');
  let n = 0;
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const tools = createToolDispatcher(registry, {
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => `pathpathpathp${String(++n).padStart(3, '0')}` as RecordId,
    screen,
    hitTest: () => undefined,
    elementsIn: () => [],
    allElements: () => [],
  });
  const made = () =>
    core.store
      .ids()
      .filter((id) => id.startsWith('pathpath'))
      .map((id) => core.store.get(id) as AnyRecord & Record<string, unknown>);
  return { core, session, tools, made };
}

describe('pen and freehand tools (FR-EDT-003)', () => {
  it('FR-EDT-003: a path box holds its points, at least 1 unit each way; its points are fractions of it', () => {
    expect(
      pathBox([
        { x: 10, y: 20 },
        { x: 110, y: 70 },
        { x: 60, y: 20 },
      ]),
    ).toEqual({
      box: { x: 10, y: 20, w: 100, h: 50 },
      fractions: [
        [0, 0],
        [1, 1],
        [0.5, 0],
      ],
    });
    // a straight run along an axis sits in the middle of its box's other side
    expect(
      pathBox([
        { x: 0, y: 5 },
        { x: 40, y: 5 },
      ]),
    ).toEqual({
      box: { x: 0, y: 5, w: 40, h: 1 },
      fractions: [
        [0, 0.5],
        [1, 0.5],
      ],
    });
    expect(pathBox([{ x: 3, y: 4 }])?.box).toEqual({ x: 3, y: 4, w: 1, h: 1 });
    expect(pathBox([{ x: 3, y: 4 }])?.fractions).toEqual([[0.5, 0.5]]);
    expect(pathBox([])).toBeUndefined();
  });

  it('FR-EDT-003: pen clicks place vertices; Enter ends the path as one polyline, one undo step', () => {
    const { core, session, tools, made } = setup();
    press(tools, key('p'));
    expect(tools.current).toBe('pen.idle');
    tools.pointer(at('down', 100, 100));
    expect(session.sketch.get()).toEqual([{ x: 100, y: 100 }]);
    tools.pointer(at('up', 100, 100));
    expect(tools.current).toBe('pen.placing');
    tools.pointer(at('move', 200, 150));
    expect(session.sketch.get()).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 150 },
    ]);
    tools.pointer(at('down', 200, 150));
    tools.pointer(at('down', 300, 100));
    expect(session.sketch.get()).toHaveLength(3);
    // another button places nothing; other keys end nothing
    tools.pointer(at('down', 250, 250, { button: 2 }));
    expect(press(tools, key('x'))).toBe(false);
    const depth = core.store.history.undoDepth;
    press(tools, key('Enter'));
    expect(made()).toEqual([
      expect.objectContaining({
        kind: 'shape',
        defId: 'basic:polyline',
        transform: { x: 100, y: 100, w: 200, h: 50 },
        params: {
          vertices: [
            [0, 0],
            [0.5, 1],
            [1, 0],
          ],
        },
      }),
    ]);
    expect([session.sketch.get(), session.tool.get(), session.selection.get()]).toEqual([undefined, 'select', [made()[0]?.id]]);
    expect(core.store.history.undoDepth).toBe(depth + 1);
  });

  it('FR-EDT-003: a click back on the last vertex ends the path; Esc drops it; one vertex adds nothing', () => {
    const { session, tools, made } = setup();
    press(tools, key('p'));
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('down', 100, 50));
    // exactly DRAG_PX from the last vertex places another; nearer ends the path
    tools.pointer(at('down', 104, 50));
    expect(made()).toHaveLength(0);
    tools.pointer(at('down', 105, 51));
    expect(made()).toHaveLength(1);
    expect((made()[0]?.['params'] as { vertices: unknown[] } | undefined)?.vertices).toHaveLength(3);
    // Esc drops a path under way
    press(tools, key('p'));
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('down', 100, 0));
    press(tools, key('Escape'));
    expect([made().length, session.sketch.get(), tools.current]).toEqual([1, undefined, 'pen.idle']);
    // one vertex, ended at once: nothing
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('down', 1, 1));
    expect(made()).toHaveLength(1);
    expect(tools.current).toBe('pen.idle');
    // another tool picked mid-path (the toolbar): the path so far goes, and adds nothing
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('down', 100, 0));
    session.tool.set('shape');
    expect(tools.current).toBe('shape.idle');
    expect([session.sketch.get(), made().length]).toEqual([undefined, 1]);
    press(tools, key('p'));
    // the window losing focus mid-path drops it too
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('down', 100, 0));
    tools.cancel();
    expect([tools.current, session.sketch.get()]).toEqual(['pen.idle', undefined]);
    // a right click does not start a path
    tools.pointer(at('down', 0, 0, { button: 2 }));
    expect(tools.current).toBe('pen.idle');
    // at 400 %, a vertex 1.5 page units on is 6 canvas px: placed, not the end; one vertex is no path
    session.camera.set({ x: 0, y: 0, z: 4 });
    tools.pointer(at('down', 0, 0));
    press(tools, key('Enter'));
    expect(made()).toHaveLength(1);
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('down', 1.5, 0));
    press(tools, key('Enter'));
    expect(made()).toHaveLength(2);
  });

  it('FR-EDT-003: freehand keeps the points a drag passed, FREEHAND_STEP_PX apart, as one freehand shape', () => {
    const { core, session, tools, made } = setup();
    expect([FREEHAND_STEP_PX, MAX_PATH_POINTS]).toEqual([2, 10_000]);
    press(tools, key('d'));
    tools.pointer(at('down', 0, 0, { button: 2 }));
    expect(tools.current).toBe('freehand.idle');
    tools.pointer(at('down', 0, 0));
    expect(tools.current).toBe('freehand.drawing');
    // coalesced moves are all read; a point under 2 px from the last kept is dropped
    tools.pointer(at('move', 20, 10, { coalesced: [at('move', 1, 0), at('move', 10, 0), at('move', 20, 10)] }));
    expect(session.sketch.get()).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ]);
    tools.pointer(at('move', 40, 0));
    const depth = core.store.history.undoDepth;
    tools.pointer(at('up', 40, 0));
    expect(made()).toEqual([
      expect.objectContaining({
        defId: 'basic:freehand',
        transform: { x: 0, y: 0, w: 40, h: 10 },
        params: {
          stroke: [
            [0, 0],
            [0.25, 0],
            [0.5, 1],
            [1, 0],
          ],
        },
      }),
    ]);
    expect([session.sketch.get(), core.store.history.undoDepth]).toEqual([undefined, depth + 1]);
  });

  it('FR-EDT-003: a freehand click or a scribble under DRAG_PX adds nothing; Esc drops a stroke; the step is in canvas px', () => {
    const { session, tools, made } = setup();
    press(tools, key('d'));
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('up', 0, 0));
    expect(tools.current).toBe('freehand.idle');
    press(tools, key('d'));
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('move', 2, 1));
    tools.pointer(at('up', 3, 0));
    expect(made()).toEqual([]);
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('move', 50, 50));
    press(tools, key('Escape'));
    expect([session.sketch.get(), made()]).toEqual([undefined, []]);
    // at 400 %, 1 page unit is 4 canvas px: kept, and the path is wide enough
    session.camera.set({ x: 0, y: 0, z: 4 });
    tools.pointer(at('down', 0, 0));
    tools.pointer(at('move', 1, 0));
    tools.pointer(at('up', 1, 0.5));
    const params = made()[0]?.['params'] as { stroke: unknown[] } | undefined;
    expect(params?.stroke).toHaveLength(3);
  });

  it('FR-EDT-003: a very long stroke keeps at most MAX_PATH_POINTS points, its last among them', () => {
    const { tools, made } = setup();
    press(tools, key('d'));
    tools.pointer(at('down', 0, 0));
    const coalesced = Array.from({ length: 12_000 }, (_, i) => at('move', (i + 1) * 3, (i % 2) * 3));
    tools.pointer(at('move', 0, 0, { coalesced }));
    tools.pointer(at('up', 36_000, 3));
    const stroke = (made()[0]?.['params'] as { stroke: [number, number][] } | undefined)?.stroke ?? [];
    expect(stroke.length).toBeLessThanOrEqual(10_000);
    expect(stroke.length).toBeGreaterThan(5_000);
    // the first point and the last are kept, the last once
    expect([stroke[0], stroke.at(-1)]).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(stroke.filter((p) => p[0] === 1)).toHaveLength(1);
  });

  it('FR-EDT-003: a stroke of twice MAX_PATH_POINTS is thinned to at most MAX_PATH_POINTS too', () => {
    const { tools, made } = setup();
    press(tools, key('d'));
    tools.pointer(at('down', 0, 0));
    const coalesced = Array.from({ length: 20_000 }, (_, i) => at('move', (i + 1) * 3, 0));
    tools.pointer(at('move', 0, 0, { coalesced }));
    tools.pointer(at('up', 60_000, 0));
    const stroke = (made()[0]?.['params'] as { stroke: unknown[] } | undefined)?.stroke ?? [];
    expect(stroke.length).toBeLessThanOrEqual(10_000);
  });
});
