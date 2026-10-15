// FR-LAY-005 and FR-LAY-001: the arrange command lays a screen, a selection or a container out in one undoable transaction.
import { type Core, createCore } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { layeredLayout, registerArrangeCommand, registerBuiltInLayouts, registerLayout } from './index.js';

type Box = { x: number; y: number; w: number; h: number };
const shape = (id: string, [x, y]: readonly [number, number], [w, h]: readonly [number, number] = [100, 50], extra: Record<string, unknown> = {}) => ({
  id,
  type: 'element',
  screenId: 's1',
  index: `a${id}`,
  kind: 'shape',
  defId: 'basic:rect',
  transform: { x, y, w, h },
  ...extra,
});

/** A core with the built-in layouts, layered, and the arrange command registered. The schema version is the one of the format at M13. */
function setup(elements: ReadonlyArray<ReturnType<typeof shape>>): Core & { box(id: string): Box } {
  const records = Object.fromEntries([
    ['doc', { id: 'doc', type: 'document', title: 'Arrange' }],
    ['s1', { id: 's1', type: 'screen', index: 'a0', name: 'Main' }],
    ...elements.map((e) => [e.id, e] as const),
  ]);
  const core = createCore({ schemaVersion: '1.3', records } as never);
  const layouts = core.registries.layouts;
  registerBuiltInLayouts(layouts);
  registerLayout(layouts, layeredLayout, 'core');
  expect(registerArrangeCommand(core.registries.commands, layouts).ok).toBe(true);
  return Object.assign(core, { box: (id: string) => (core.store.get(id as never) as unknown as { transform: Box }).transform });
}
const overlapping = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('arrange command (FR-LAY-005)', () => {
  it('FR-LAY-005: arranging a screen lays its elements out with the chosen algorithm as one undo step, and undo restores every box', () => {
    const core = setup([shape('e1', [0, 0]), shape('e2', [10, 10]), shape('e3', [20, 20])]);
    const before = ['e1', 'e2', 'e3'].map((id) => core.box(id));
    const result = core.execute('layout.arrange', { screenId: 's1', algorithm: 'grid', options: { columns: 2, gap: 10, padding: 0 } });
    expect(result).toMatchObject({ ok: true, value: { moved: 2 } });
    expect(core.box('e1')).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(core.box('e2')).toEqual({ x: 110, y: 0, w: 100, h: 50 });
    expect(core.box('e3')).toEqual({ x: 0, y: 60, w: 100, h: 50 });
    // one transaction: a single undo brings all three back
    expect(core.store.history.undo().ok).toBe(true);
    expect(['e1', 'e2', 'e3'].map((id) => core.box(id))).toEqual(before);
  });

  it('FR-LAY-005: arranging a selection moves only the selection, keeps clear of the rest, and leaves the rest where it was', () => {
    const core = setup([shape('a', [0, 0]), shape('b', [5, 5]), shape('c', [10, 10]), shape('rest', [400, 300], [200, 100])]);
    const rest = core.box('rest');
    const result = core.execute('layout.arrange', {
      screenId: 's1',
      scope: 'selection',
      selection: ['a', 'b', 'c'],
      algorithm: 'stack',
      options: { padding: 380, gap: 10 },
    });
    expect(result.ok).toBe(true);
    expect(core.box('rest')).toEqual(rest);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => core.box(id));
    for (const [x, y] of [
      [a, b],
      [a, c],
      [b, c],
    ] as const)
      expect(overlapping(x as Box, y as Box)).toBe(false);
    for (const moved of [a, b, c]) expect(overlapping(moved as Box, rest)).toBe(false);
    // nothing selected means nothing moves
    const idle = core.execute('layout.arrange', { screenId: 's1', scope: 'selection', selection: [], algorithm: 'grid' });
    expect(idle).toMatchObject({ ok: true, value: { moved: 0 } });
  });

  it('FR-LAY-005: arranging a container lays its children out inside its frame, and a container layout spec picks the algorithm', () => {
    const frame = shape('f', [200, 100], [500, 400], { kind: 'frame', layout: { type: 'stack', options: { direction: 'right', gap: 20, padding: 10 } } });
    const core = setup([frame, shape('k1', [0, 0], [80, 40], { parentId: 'f' }), shape('k2', [0, 0], [60, 30], { parentId: 'f' }), shape('out', [900, 900])]);
    const result = core.execute('layout.arrange', { screenId: 's1', scope: { containerId: 'f' }, algorithm: 'grid' });
    expect(result.ok).toBe(true);
    // the frame's own spec (stack to the right, padding 10, gap 20) wins over the requested grid, inside the frame's box
    expect(core.box('k1')).toEqual({ x: 210, y: 110, w: 80, h: 40 });
    expect(core.box('k2')).toEqual({ x: 310, y: 110, w: 60, h: 30 });
    expect(core.box('f')).toEqual({ x: 200, y: 100, w: 500, h: 400 });
    expect(core.box('out')).toEqual({ x: 900, y: 900, w: 100, h: 50 });
  });

  it('FR-LAY-001: arrange refuses an unknown algorithm, an option the algorithm rejects, an empty screen and an unknown container, and changes nothing', () => {
    const core = setup([shape('e1', [0, 0]), shape('e2', [10, 10])]);
    const snapshot = JSON.stringify(core.store.toDocument());
    for (const args of [
      { screenId: 's1', algorithm: 'tree' },
      { screenId: 's1', algorithm: 'grid', options: { columns: 0 } },
      { screenId: 'nowhere' },
      { screenId: 's1', scope: { containerId: 'ghost' } },
    ]) {
      expect(core.execute('layout.arrange', args)).toMatchObject({ ok: false, error: { code: 'COMMAND_ARGS' } });
    }
    expect(core.execute('layout.arrange', { screenId: 7 })).toMatchObject({ ok: false });
    expect(JSON.stringify(core.store.toDocument())).toBe(snapshot);
    expect(core.store.history.canUndo()).toBe(false);
  });
});
