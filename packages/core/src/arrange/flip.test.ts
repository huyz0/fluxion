// FR-SHP-009: element.flip (M19.16) mirrors each element about its own centre, a group's members with it, in one undo step.
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createCore } from '../bootstrap.js';

type Box = { x: number; y: number; w: number; h: number; rot?: number; flipX?: boolean; flipY?: boolean };

/** Rect a (0,0 100x50), rects b and c grouped (200..400 across), a free connector, and the core. */
function setup() {
  const b = documentBuilder({ seed: 1916 });
  const s = b.screen();
  const a = b.rect(s, { x: 0, y: 0, w: 100, h: 50 });
  const m1 = b.rect(s, { x: 200, y: 0, w: 50, h: 50 });
  const m2 = b.rect(s, { x: 350, y: 20, w: 50, h: 30 });
  const line = b.connect({ x: 0, y: 300 }, { x: 100, y: 300 });
  const core = createCore(b.build());
  expect(core.execute('element.group', { ids: [m1, m2], groupId: 'g1' }).ok).toBe(true);
  core.store.history.seal();
  const t = (id: RecordId) => (core.store.get(id) as unknown as { transform: Box }).transform;
  return { core, a, m1, m2, line, g: 'g1' as RecordId, t };
}

describe('element.flip (FR-SHP-009)', () => {
  it('FR-SHP-009: a horizontal flip toggles flipX and keeps the box; flipping twice restores it; one undo step each', () => {
    const { core, a, t } = setup();
    const before = { ...t(a) };
    const depth = core.store.history.undoDepth;
    expect(core.execute('element.flip', { ids: [a], axis: 'x' }).ok).toBe(true);
    expect(t(a)).toEqual({ ...before, rot: 0, flipX: true });
    expect(core.store.history.undoDepth).toBe(depth + 1);
    expect(core.execute('element.flip', { ids: [a], axis: 'y' }).ok).toBe(true);
    expect(t(a)).toMatchObject({ flipX: true, flipY: true });
    core.store.history.undo();
    core.store.history.undo();
    expect(t(a)).toEqual(before);
    expect(core.execute('element.flip', { ids: [a], axis: 'x' }).ok).toBe(true);
    expect(core.execute('element.flip', { ids: [a], axis: 'x' }).ok).toBe(true);
    expect(t(a)).toMatchObject({ x: 0, y: 0, w: 100, h: 50, flipX: false });
  });

  it("FR-SHP-009: a group's members are mirrored across the group's centre line; a member listed with its group flips once", () => {
    const { core, g, m1, m2, t } = setup();
    // the group spans 200..400: centre line x = 300
    expect(core.execute('element.flip', { ids: [g, m1], axis: 'x' }).ok).toBe(true);
    expect(t(m1)).toMatchObject({ x: 350, y: 0, flipX: true });
    expect(t(m2)).toMatchObject({ x: 200, y: 20, flipX: true });
    expect(t(g)).toMatchObject({ x: 200, w: 200 });
  });

  it('FR-SHP-009: nothing with a box to flip is refused', () => {
    const { core, line } = setup();
    expect(core.execute('element.flip', { ids: [line], axis: 'x' }).ok).toBe(false);
  });
});
