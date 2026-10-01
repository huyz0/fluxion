import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { press } from './__fixtures__/keys.js';
import { registerBuiltinTools } from './builtin-tools.js';
import { LASER_TRAIL } from './laser-tool.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry, type KeyInfo } from './tools.js';

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
const key = (k: string): KeyInfo => ({ key: k, shift: false, alt: false, mod: false });

function setup() {
  const b = documentBuilder({ seed: 185 });
  const screen = b.screen();
  b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
  const core = createCore(b.build());
  const session = createSession('doc');
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const ctx = {
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => 'LaserLaserLaser1' as RecordId,
    screen,
    hitTest: () => undefined,
    elementsIn: () => [],
    allElements: () => [],
  };
  return { core, session, registry, ctx };
}

describe('the laser (FR-EDT-003)', () => {
  it('FR-EDT-003: the laser is listed for present mode, not edit; present mode lists only it', () => {
    const { session, registry, ctx } = setup();
    const edit = createToolDispatcher(registry, ctx);
    const present = createToolDispatcher(registry, ctx, 'present');
    expect(edit.list().map((t) => t.id)).not.toContain('laser');
    expect(present.list().map((t) => t.id)).toEqual(['laser']);
    // in edit, L is no shortcut and the laser cannot be picked: select stands in
    expect(press(edit, key('l'))).toBe(false);
    session.tool.set('laser');
    expect(edit.current).toBe('select.idle');
    // in present mode the session's edit tool falls back to the laser, and L picks it
    session.tool.set('select');
    expect(present.current).toBe('laser.idle');
    expect(press(present, key('l'))).toBe(true);
    expect(press(present, key('v'))).toBe(false);
  });

  it('FR-EDT-003: the laser follows the pointer with a short trail and writes nothing', () => {
    const { core, session, registry, ctx } = setup();
    const before = core.store.toDocument();
    const present = createToolDispatcher(registry, ctx, 'present');
    expect(LASER_TRAIL).toBe(12);
    for (let i = 0; i < 20; i++) present.pointer(at('move', i, 2 * i));
    const trail = session.laser.get();
    expect([trail.length, trail[0], trail.at(-1)]).toEqual([12, { x: 8, y: 16 }, { x: 19, y: 38 }]);
    // presses and drags neither select nor move
    present.pointer(at('down', 50, 50));
    present.pointer(at('move', 60, 60));
    present.pointer(at('up', 60, 60));
    expect([session.selection.get(), core.store.toDocument(), core.store.history.undoDepth]).toEqual([[], before, 0]);
    // Esc or the window losing focus clears the trail
    press(present, key('Escape'));
    expect(session.laser.get()).toEqual([]);
    present.pointer(at('move', 1, 1));
    present.cancel();
    expect(session.laser.get()).toEqual([]);
  });

  it('FR-EDT-003: leaving the laser clears its trail', () => {
    const { session, registry, ctx } = setup();
    const present = createToolDispatcher(registry, ctx, 'present');
    present.pointer(at('move', 1, 1));
    registry.register('pointer', { id: 'pointer', title: 'Pointer', modes: ['present'], initial: 'idle', states: { idle: { id: 'idle' } } }, 'test');
    session.tool.set('pointer');
    expect(present.current).toBe('pointer.idle');
    expect(session.laser.get()).toEqual([]);
  });
});
