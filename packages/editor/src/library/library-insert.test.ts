import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from '../builtin-tools.js';
import type { PointerInfo, PointerPhase } from '../pointer.js';
import { createSession } from '../session.js';
import { createToolDispatcher, createToolRegistry } from '../tools.js';
import { insertShape } from './library-insert.js';

const def = (id: string, w: number, h: number): ShapeDef =>
  ({ id, outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w, h } }) as unknown as ShapeDef;

const at = (phase: PointerPhase, x: number, y: number): PointerInfo => ({
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
});

function setup() {
  const b = documentBuilder({ seed: 501 });
  const screen = b.screen();
  const core = createCore(b.build());
  const session = createSession('doc');
  const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
  for (const d of [def('basic:rect', 160, 100), def('basic:cylinder', 90, 120)]) shapeDefs.register(d.id, d, 'test');
  let n = 0;
  const deps = {
    view: core.store,
    screen,
    newId: () => `LibNew${String(++n).padStart(10, '0')}` as RecordId,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    session,
    shapeDefs,
  };
  const placed = (id: RecordId) => core.store.get(id) as unknown as { defId: string; transform: { x: number; y: number; w: number; h: number } };
  return { core, session, deps, placed, screen };
}

describe('library insert (FR-LIB-002)', () => {
  it('FR-LIB-002: an item is put centred on the point at its default size, selected, in one undo step, and becomes the current item', () => {
    const t = setup();
    expect(t.session.library.get()).toBe('basic:rect');
    const id = insertShape(t.deps, 'basic:cylinder', { x: 500, y: 300 }) as RecordId;
    expect(t.placed(id)).toMatchObject({ defId: 'basic:cylinder', transform: { x: 455, y: 240, w: 90, h: 120 } });
    expect([t.session.selection.get(), t.session.library.get(), t.core.store.history.undoDepth]).toEqual([[id], 'basic:cylinder', 1]);
    t.core.store.history.undo();
    expect(t.core.store.has(id)).toBe(false);
  });

  it('FR-LIB-002: an unknown definition adds nothing and changes nothing', () => {
    const t = setup();
    expect(insertShape(t.deps, 'basic:nope', { x: 0, y: 0 })).toBeUndefined();
    expect([t.core.store.history.undoDepth, t.session.library.get(), t.session.selection.get()]).toEqual([0, 'basic:rect', []]);
    expect(insertShape({ ...t.deps, screen: undefined }, 'basic:rect', { x: 0, y: 0 })).toBeUndefined();
    expect(t.session.library.get()).toBe('basic:rect');
  });

  it('FR-EDT-003: the shape tool places the library`s current item, read when it places the element', () => {
    const t = setup();
    const registry = createToolRegistry();
    registerBuiltinTools(registry);
    const tools = createToolDispatcher(registry, {
      session: t.session,
      view: t.core.store,
      execute: t.core.execute,
      seal: t.deps.seal,
      newId: t.deps.newId,
      hitTest: () => undefined,
      elementsIn: () => [],
      screen: t.screen,
      allElements: () => [],
    });
    const drag = (from: number, to: number) => {
      tools.use('shape');
      tools.pointer(at('down', from, from));
      tools.pointer(at('move', to, to));
      tools.pointer(at('up', to, to));
    };
    // no pick yet: a rectangle
    drag(10, 110);
    // the current item changes after the tool was chosen: the next drag places it
    t.session.library.set('basic:cylinder');
    drag(200, 330);
    const made = t.core.store.members('byType', 'element').map((id) => t.placed(id).defId);
    expect(made).toEqual(['basic:rect', 'basic:cylinder']);
  });
});
