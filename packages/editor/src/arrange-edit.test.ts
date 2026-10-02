import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { alignSelection, distributeSelection, orderSelection } from './arrange-edit.js';
import { createSession } from './session.js';
import type { ToolCtx } from './tools.js';

/** Three shapes on a screen of 1000 x 600 and a tool context over a real core. */
function setup() {
  const b = documentBuilder({ seed: 601 });
  const screen = b.screen({ size: { w: 1000, h: 600 } });
  const a = b.rect(screen, { x: 20, y: 100, w: 100, h: 50 });
  const c = b.rect(screen, { x: 200, y: 300, w: 100, h: 50 });
  const d = b.rect(screen, { x: 700, y: 200, w: 100, h: 50 });
  const core = createCore(b.build());
  const session = createSession('doc');
  const ctx = { session, execute: core.execute } as unknown as ToolCtx;
  const at = (id: RecordId) => (core.store.get(id) as unknown as { transform: { x: number; y: number } }).transform;
  return { core, session, ctx, a, c, d, at };
}

describe('arranging the selection (FR-ARR-002, FR-ARR-003, FR-ARR-004)', () => {
  it('FR-ARR-002: several elements align to their own bounds, one to the screen, in one undo step', () => {
    const t = setup();
    t.session.selection.set([t.a, t.c, t.d]);
    expect(alignSelection(t.ctx, 'left')).toBe(true);
    expect([t.at(t.a).x, t.at(t.c).x, t.at(t.d).x]).toEqual([20, 20, 20]);
    expect(t.core.store.history.undoDepth).toBe(1);
    // one element: against the screen
    t.session.selection.set([t.d]);
    expect(alignSelection(t.ctx, 'right')).toBe(true);
    expect(t.at(t.d).x).toBe(900);
    t.session.selection.set([]);
    expect(alignSelection(t.ctx, 'left')).toBe(false);
  });

  it('FR-ARR-003: three or more are spaced evenly; fewer are refused', () => {
    const t = setup();
    t.session.selection.set([t.a, t.c, t.d]);
    expect(distributeSelection(t.ctx, 'horizontal')).toBe(true);
    const gaps = [t.at(t.c).x - (t.at(t.a).x + 100), t.at(t.d).x - (t.at(t.c).x + 100)];
    expect(gaps[0]).toBeCloseTo(gaps[1] as number, 6);
    t.session.selection.set([t.a, t.c]);
    expect(distributeSelection(t.ctx, 'vertical')).toBe(false);
  });

  it('FR-ARR-004: the selection moves in the stacking order, one undo step', () => {
    const t = setup();
    t.session.selection.set([t.a]);
    const depth = t.core.store.history.undoDepth;
    expect(orderSelection(t.ctx, 'front')).toBe(true);
    expect(t.core.store.history.undoDepth).toBe(depth + 1);
    t.session.selection.set([]);
    expect(orderSelection(t.ctx, 'back')).toBe(false);
  });
});
