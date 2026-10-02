import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { registries } from './__fixtures__/hit-shapes.js';
import { enteredHolds, enterGroup, exitGroup, groupSelection, ungroupSelection } from './group-edit.js';
import { createHitIndex } from './hit-test.js';
import { createSession } from './session.js';
import type { ToolCtx } from './tools.js';

/** Four rectangles on a screen in a row, the editor's tool context over the core's store and the hit index. */
function setup() {
  const b = documentBuilder({ seed: 83 });
  const screen = b.screen({ size: { w: 1000, h: 400 } });
  const rects = [0, 1, 2, 3].map((k) => b.rect(screen, { x: 20 + k * 200, y: 100, w: 100, h: 100 })) as [RecordId, RecordId, RecordId, RecordId];
  const core = createCore(b.build());
  const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
  const session = createSession('doc');
  let n = 0;
  const ctx = {
    session,
    view: core.store,
    execute: core.execute,
    newId: () => `NewGroupNewGroup${++n}` as RecordId,
    // a click picks what the hit index says, inside the entered group when there is one
    hitTest: (p: { x: number; y: number }) => {
      const hit = hits.hitTest(screen, p, 1);
      return hit === undefined ? undefined : hits.selectableOf(hit, session.entered.get());
    },
  } as unknown as ToolCtx;
  const parent = (id: RecordId) => (core.store.get(id) as { parentId?: RecordId }).parentId;
  return { core, rects, session, ctx, parent, hits };
}

describe('grouping in the editor (FR-ARR-001)', () => {
  it('FR-ARR-001: Group makes one group of the selection, selects it, and is one undo step', () => {
    const { core, rects, session, ctx, parent } = setup();
    session.selection.set([rects[0], rects[1]]);
    const steps = core.store.history.canUndo();
    expect(groupSelection(ctx)).toBe(true);
    const [group] = session.selection.get();
    expect(session.selection.get()).toHaveLength(1);
    expect([parent(rects[0]), parent(rects[1]), parent(rects[2])]).toEqual([group, group, undefined]);
    core.store.history.undo();
    expect(parent(rects[0])).toBeUndefined();
    expect(core.store.history.canUndo()).toBe(steps);
  });

  it('FR-ARR-001: Group does nothing with nothing selected or when the document refuses (not siblings)', () => {
    const { rects, session, ctx, core } = setup();
    expect(groupSelection(ctx)).toBe(false);
    session.selection.set([rects[0]]);
    expect(groupSelection(ctx)).toBe(true);
    const group = session.selection.get()[0] as RecordId;
    // a member and a root element are not siblings
    session.selection.set([rects[0], rects[2]]);
    expect(groupSelection(ctx)).toBe(false);
    expect(session.selection.get()).toEqual([rects[0], rects[2]]);
    expect(core.store.get(group)).toBeDefined();
  });

  it('FR-ARR-001: Ungroup dissolves the selected groups one level and selects their members', () => {
    const { rects, session, ctx, parent, core } = setup();
    session.selection.set([rects[0], rects[1]]);
    groupSelection(ctx);
    session.selection.set([...session.selection.get(), rects[2]]);
    expect(groupSelection(ctx)).toBe(true);
    const outer = session.selection.get()[0] as RecordId;
    expect(ungroupSelection(ctx)).toBe(true);
    // one level: the inner group and the third rectangle come out
    expect(session.selection.get()).toHaveLength(2);
    expect(session.selection.get()).toContain(rects[2]);
    expect(parent(rects[2])).toBeUndefined();
    const innerGroup = session.selection.get().find((x) => x !== rects[2]) as RecordId;
    expect(parent(innerGroup)).toBeUndefined();
    expect(parent(rects[0])).toBe(innerGroup);
    expect(core.store.get(outer)).toBeUndefined();
    // nothing to ungroup in a selection of plain shapes
    session.selection.set([rects[3]]);
    expect(ungroupSelection(ctx)).toBe(false);
  });

  it('FR-ARR-001: a double-click enters a group and selects the member under the pointer; Esc leaves it with the group selected', () => {
    const { rects, session, ctx, hits } = setup();
    session.selection.set([rects[0], rects[1]]);
    groupSelection(ctx);
    const group = session.selection.get()[0] as RecordId;
    // a click on a member picks the group; entered, it picks the member
    const onFirst = { x: 70, y: 150 };
    expect(ctx.hitTest(onFirst)).toBe(group);
    expect(enterGroup(ctx, group, onFirst)).toBe(true);
    expect(session.entered.get()).toBe(group);
    expect(session.selection.get()).toEqual([rects[0]]);
    expect(ctx.hitTest({ x: 270, y: 150 })).toBe(rects[1]);
    expect(exitGroup(ctx)).toBe(true);
    expect(session.entered.get()).toBeUndefined();
    expect(session.selection.get()).toEqual([group]);
    expect(exitGroup(ctx)).toBe(false);
    // a plain shape is no group
    expect(enterGroup(ctx, rects[3], onFirst)).toBe(false);
    expect(session.entered.get()).toBeUndefined();
    hits.dispose();
  });

  it('FR-ARR-001: an entered group holds while the selection is inside it, and lapses otherwise or when it is gone', () => {
    const { rects, session, ctx, core } = setup();
    session.selection.set([rects[0], rects[1]]);
    groupSelection(ctx);
    const group = session.selection.get()[0] as RecordId;
    expect(enteredHolds(core.store, group, [rects[0], rects[1]])).toBe(true);
    expect(enteredHolds(core.store, group, [rects[0], rects[2]])).toBe(false);
    expect(enteredHolds(core.store, group, [])).toBe(false);
    // the group itself is not inside itself; a plain shape is no group; a deleted group holds nothing
    expect(enteredHolds(core.store, group, [group])).toBe(false);
    expect(enteredHolds(core.store, rects[3], [rects[0]])).toBe(false);
    ungroupSelection(ctx);
    expect(enteredHolds(core.store, group, [rects[0]])).toBe(false);
  });

  it('FR-ARR-001: inside an entered group a click picks the outermost group below it, and entering the inner group picks the member', () => {
    const { rects, session, ctx, hits } = setup();
    session.selection.set([rects[0], rects[1]]);
    groupSelection(ctx);
    const inner = session.selection.get()[0] as RecordId;
    session.selection.set([inner, rects[2]]);
    groupSelection(ctx);
    const outer = session.selection.get()[0] as RecordId;
    const onFirst = { x: 70, y: 150 };
    const onThird = { x: 470, y: 150 };
    expect([ctx.hitTest(onFirst), ctx.hitTest(onThird)]).toEqual([outer, outer]);
    expect(enterGroup(ctx, outer, onFirst)).toBe(true);
    // one level in: the inner group stands for its members, the third rectangle stands alone
    expect([ctx.hitTest(onFirst), ctx.hitTest(onThird)]).toEqual([inner, rects[2]]);
    expect(session.selection.get()).toEqual([inner]);
    expect(enterGroup(ctx, inner, onFirst)).toBe(true);
    expect(ctx.hitTest(onFirst)).toBe(rects[0]);
    expect(session.selection.get()).toEqual([rects[0]]);
    // Esc leaves the inner group only: it is selected and the outer group stays entered; the next Esc leaves that too
    expect(exitGroup(ctx)).toBe(true);
    expect(session.selection.get()).toEqual([inner]);
    expect(session.entered.get()).toBe(outer);
    expect(exitGroup(ctx)).toBe(true);
    expect(session.entered.get()).toBeUndefined();
    expect(session.selection.get()).toEqual([outer]);
    hits.dispose();
  });
});
