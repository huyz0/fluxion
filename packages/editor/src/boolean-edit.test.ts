import { CORE_PATH_DEF, CORE_PATH_ID, createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import type { PathData, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { LINE, RECT } from './__fixtures__/hit-shapes.js';
import { combineSelection } from './boolean-edit.js';
import { createSession } from './session.js';
import type { ToolCtx } from './tools.js';

/** Two overlapping rects a (bottom, 100..300) and top (250..350), a line, and a tool context with their definitions. */
function setup() {
  const b = documentBuilder({ seed: 1918 });
  const screen = b.screen({ size: { w: 1000, h: 600 } });
  const a = b.rect(screen, { x: 100, y: 100, w: 200, h: 100 });
  const top = b.rect(screen, { x: 250, y: 100, w: 100, h: 100, rot: 90 });
  const line = b.rect(screen, { x: 500, y: 100, w: 100, h: 16, defId: 'basic:line' });
  const far = b.rect(screen, { x: 800, y: 400, w: 50, h: 50 });
  const core = createCore(b.build());
  const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
  for (const def of [RECT, LINE, CORE_PATH_DEF]) shapeDefs.register(def.id, def, 'test');
  const session = createSession('doc');
  let n = 0;
  const ctx = { session, execute: core.execute, view: core.store, shapeDefs, newId: () => `made${n++}` } as unknown as ToolCtx;
  return { core, session, ctx, a, top, line, far };
}

const made = (t: ReturnType<typeof setup>, id: string) =>
  t.core.store.get(id as RecordId) as unknown as { defId: string; path: PathData; transform: { x: number; w: number } };

describe('boolean operations in the editor (FR-SHP-010)', () => {
  it('FR-SHP-010: the selected shapes become one selected path shape in one undo step; a turned operand is placed', () => {
    const t = setup();
    t.session.selection.set([t.top, t.a]);
    expect(combineSelection(t.ctx, 'union')).toBe(true);
    expect(t.session.selection.get()).toEqual(['made0']);
    const r = made(t, 'made0');
    expect(r.defId).toBe(CORE_PATH_ID);
    // the turned square still covers 250..350
    expect(r.transform).toMatchObject({ x: 100, w: 250 });
    expect(t.core.store.history.undoDepth).toBe(1);
    t.core.store.history.undo();
    expect(t.core.store.has(t.a) && t.core.store.has(t.top)).toBe(true);
  });

  it('FR-SHP-010: subtract takes the upper shape from the bottom one, whatever the selection order', () => {
    const t = setup();
    t.session.selection.set([t.top, t.a]);
    expect(combineSelection(t.ctx, 'subtract')).toBe(true);
    expect(made(t, 'made0').transform).toMatchObject({ x: 100, w: 150 });
  });

  it('FR-SHP-010: a path shape result is an operand again, and its own path is what combines', () => {
    const t = setup();
    t.session.selection.set([t.a, t.top]);
    expect(combineSelection(t.ctx, 'union')).toBe(true);
    t.session.selection.set(['made0' as RecordId, t.far]);
    expect(combineSelection(t.ctx, 'union')).toBe(true);
    expect(made(t, 'made1').transform).toMatchObject({ x: 100, w: 750 });
    expect(made(t, 'made1').path.d.match(/M/g)).toHaveLength(2);
  });

  it('FR-SHP-010: fewer than two shapes, an open outline, or no area does nothing', () => {
    const t = setup();
    t.session.selection.set([t.a]);
    expect(combineSelection(t.ctx, 'union')).toBe(false);
    t.session.selection.set([t.a, t.line]);
    expect(combineSelection(t.ctx, 'union')).toBe(false);
    t.session.selection.set([t.a, t.far]);
    expect(combineSelection(t.ctx, 'intersect')).toBe(false);
    expect(t.core.store.history.undoDepth).toBe(0);
  });
});
