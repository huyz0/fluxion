import { createCore } from '@fluxion/core';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { press } from './__fixtures__/keys.js';
import { registerBuiltinTools } from './builtin-tools.js';
import { createConnector } from './connector-tool.js';
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

/** Two boxes and a connector between them, the built-in tools on a real core, hit-testing by boxes. */
function setup(onScreen = true) {
  const b = documentBuilder({ seed: 181 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
  const c = b.rect(screen, { x: 400, y: 0, w: 100, h: 100 });
  const line = b.connect({ x: 0, y: 300 }, { x: 500, y: 300 });
  const core = createCore(b.build());
  const session = createSession('doc');
  let n = 0;
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const deps = {
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => `linklinklinkl${String(++n).padStart(3, '0')}` as RecordId,
    screen: onScreen ? screen : undefined,
  };
  const box = (id: RecordId) => (core.store.get(id) as { transform?: { x: number; y: number; w: number; h: number } }).transform;
  const hitTest = (p: { x: number; y: number }) => {
    const boxed = [a, c].find((id) => {
      const t = box(id);
      return t !== undefined && p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h;
    });
    return boxed ?? (Math.abs(p.y - 300) < 5 ? line : undefined);
  };
  const tools = createToolDispatcher(registry, { ...deps, hitTest, elementsIn: () => [], allElements: () => [] });
  const made = () => core.store.ids().filter((id) => id.startsWith('linklink') && core.store.get(id)?.type === 'element');
  const record = (id: RecordId | undefined) => core.store.get(id as RecordId) as (AnyRecord & Record<string, unknown>) | undefined;
  const bindings = (id: RecordId | undefined) =>
    core.store
      .members('byType', 'binding')
      .map((b) => core.store.get(b) as unknown as { connectorId: string; end: string; elementId: string; anchor: unknown })
      .filter((b) => b.connectorId === id)
      .map((b) => [b.end, b.elementId, b.anchor]);
  const drag = (from: [number, number], to: [number, number], alt = false) => {
    tools.pointer(at('down', ...from));
    tools.pointer(at('move', ...to));
    tools.pointer(at('up', ...to, { alt }));
  };
  return { core, screen, a, c, line, session, tools, deps, made, record, bindings, drag };
}

describe('the connector tool (FR-EDT-003)', () => {
  it('FR-EDT-003: a drag from one element to another joins them, bound at both ends, in one undo step', () => {
    const { core, a, c, session, tools, made, record, bindings, drag } = setup();
    press(tools, key('c'));
    expect(tools.current).toBe('connector.idle');
    const depth = core.store.history.undoDepth;
    drag([50, 50], [450, 50]);
    const [id] = made();
    expect(made()).toHaveLength(1);
    expect(record(id)).toMatchObject({ kind: 'connector', route: { type: 'straight' }, markers: { end: 'arrow' } });
    // bound ends have no free point
    expect([record(id)?.['freeSource'], record(id)?.['freeTarget']]).toEqual([undefined, undefined]);
    expect(bindings(id)).toEqual([
      ['source', a, { kind: 'auto' }],
      ['target', c, { kind: 'auto' }],
    ]);
    expect([session.selection.get(), session.tool.get()]).toEqual([[id], 'select']);
    expect(core.store.history.undoDepth).toBe(depth + 1);
    core.store.history.undo();
    expect([made(), bindings(id)]).toEqual([[], []]);
  });

  it('FR-EDT-003: an end dropped on nothing, or on a connector, stays free; alt makes it curved', () => {
    const { a, tools, made, record, bindings, drag } = setup();
    press(tools, key('c'));
    drag([50, 50], [250, 200]);
    const [first] = made();
    expect(bindings(first)).toEqual([['source', a, { kind: 'auto' }]]);
    expect([record(first)?.['freeSource'], record(first)?.['freeTarget']]).toEqual([undefined, { x: 250, y: 200 }]);
    press(tools, key('c'));
    drag([200, 300], [250, 500], true);
    const second = made().find((id) => id !== first);
    expect(bindings(second)).toEqual([]);
    expect(record(second)).toMatchObject({ route: { type: 'curved' }, freeSource: { x: 200, y: 300 }, freeTarget: { x: 250, y: 500 } });
  });

  it('FR-EDT-003: the drag draws its line and hovers the element it would bind; Esc, a click or a drag back add nothing', () => {
    const { c, session, tools, made, drag } = setup();
    press(tools, key('c'));
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('move', 450, 50));
    expect([session.sketch.get(), session.hover.get()]).toEqual([
      [
        { x: 50, y: 50 },
        { x: 450, y: 50 },
      ],
      c,
    ]);
    tools.pointer(at('move', 250, 300));
    expect(session.hover.get()).toBeUndefined();
    press(tools, key('Escape'));
    expect([tools.current, session.sketch.get(), session.hover.get()]).toEqual(['connector.idle', undefined, undefined]);
    // a click (under DRAG_PX), a drag from an element back onto it, and another button: nothing
    drag([50, 50], [52, 51]);
    drag([10, 10], [90, 90]);
    tools.pointer(at('down', 50, 50, { button: 2 }));
    expect([made(), tools.current, session.sketch.get()]).toEqual([[], 'connector.idle', undefined]);
  });

  it('FR-EDT-003: without a screen, or when the command refuses, nothing is added', () => {
    const off = setup(false);
    const link = { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, source: undefined, target: undefined, curved: false };
    expect(createConnector(off.deps, link)).toBeUndefined();
    const { deps, session, made } = setup();
    session.tool.set('connector');
    const refusing = { ...deps, execute: () => ({ ok: false as const, error: { code: 'X', message: 'no' } as never }) };
    expect(createConnector(refusing, link)).toBeUndefined();
    expect([made(), session.selection.get(), session.tool.get()]).toEqual([[], [], 'connector']);
  });
});

describe('the connector tool, edges (FR-EDT-003)', () => {
  it('FR-EDT-003: a drag is at least DRAG_PX canvas px, at any zoom; the press starts linking', () => {
    const { session, tools, made, drag } = setup();
    press(tools, key('c'));
    tools.pointer(at('down', 200, 200));
    expect(tools.current).toBe('connector.linking');
    tools.pointer(at('up', 202, 201));
    // 3 page units at 100 % is a click; exactly 4 is a drag
    drag([200, 200], [203, 200]);
    expect(made()).toEqual([]);
    drag([200, 200], [204, 200]);
    expect(made()).toHaveLength(1);
    // at 400 %, 1.5 page units are 6 canvas px
    press(tools, key('c'));
    session.camera.set({ x: 0, y: 0, z: 4 });
    drag([200, 200], [201.5, 200]);
    expect(made()).toHaveLength(2);
  });

  it('FR-EDT-003: each connector is its own undo step; only the ends that bind write a binding', () => {
    const { core, tools, deps, drag } = setup();
    const calls: string[] = [];
    const counted = {
      ...deps,
      execute: ((id, args, o) => {
        calls.push(id);
        return core.execute(id, args, o);
      }) as typeof deps.execute,
    };
    const depth = core.store.history.undoDepth;
    press(tools, key('c'));
    drag([50, 50], [450, 50]);
    press(tools, key('c'));
    drag([50, 50], [450, 50]);
    expect(core.store.history.undoDepth).toBe(depth + 2);
    createConnector(counted, { from: { x: 0, y: 0 }, to: { x: 9, y: 9 }, source: undefined, target: undefined, curved: false });
    expect(calls).toEqual(['element.create']);
  });

  it('FR-EDT-003: nothing is written without a screen, and no binding after a refused connector', () => {
    const { deps } = setup(false);
    const calls: string[] = [];
    const link = { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, source: 'a' as RecordId, target: 'b' as RecordId, curved: false };
    const refuse = ((id: string) => {
      calls.push(id);
      return { ok: false, error: { code: 'X', message: 'no' } };
    }) as never;
    expect(createConnector({ ...deps, execute: refuse }, link)).toBeUndefined();
    expect(calls).toEqual([]);
    const on = setup();
    expect(createConnector({ ...on.deps, execute: refuse }, link)).toBeUndefined();
    expect(calls).toEqual(['element.create']);
    // a screen whose root indexes are malformed has no place in front for it
    const broken = { ...on.deps, view: { members: () => ['x'], get: () => ({ index: '!!' }) } as never, execute: refuse };
    expect(createConnector(broken, link)).toBeUndefined();
    expect(calls).toEqual(['element.create']);
  });

  it('FR-EDT-003: Esc while hovering a target clears the hover', () => {
    const { session, tools } = setup();
    press(tools, key('c'));
    tools.pointer(at('down', 50, 50));
    tools.pointer(at('move', 450, 50));
    press(tools, key('Escape'));
    expect([session.hover.get(), session.sketch.get()]).toEqual([undefined, undefined]);
  });
});
