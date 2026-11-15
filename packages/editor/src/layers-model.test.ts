import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { isLocked, layerDrop, layerRows, toggledLocks } from './layers-model.js';

/** Four rects back to front, the middle two grouped, on one screen, and a rect on a second screen. */
function setup() {
  const b = documentBuilder({ seed: 1914 });
  const s = b.screen();
  const ids = [0, 1, 2, 3].map((i) => b.rect(s, { x: i * 50, y: 0, w: 40, h: 40 })) as [RecordId, RecordId, RecordId, RecordId];
  b.rect(b.screen(), { x: 0, y: 0, w: 40, h: 40 });
  const core = createCore(b.build());
  expect(core.execute('element.group', { ids: [ids[1], ids[2]], groupId: 'g1', name: 'Pair' }).ok).toBe(true);
  return { core, s, ids, rows: () => layerRows(core.store, s) };
}

describe('the layers panel model (FR-ARR-008, M19.14)', () => {
  it('FR-ARR-008: the rows are the screen elements front first, members indented under their group', () => {
    const { rows, ids, core } = setup();
    const [a, b, c, d] = ids;
    expect(rows().map((r) => [r.id, r.depth])).toEqual([
      [d, 0],
      ['g1', 0],
      [c, 1],
      [b, 1],
      [a, 0],
    ]);
    expect(rows()[1]?.label).toBe('Pair');
    expect(rows()[0]?.label).toBe('Shape');
    core.execute('element.update', { id: a, fields: { hidden: true, locks: { position: true, size: true, rotation: true, select: true } } });
    expect(rows().at(-1)).toMatchObject({ hidden: true, locked: true });
  });

  it('FR-ARR-008: a drop on the upper half puts the row in front of the target, on the lower half behind it', () => {
    const { rows, ids } = setup();
    const [a, b, c, d] = ids;
    // d is in front: dropped on the lower half of a it goes to the very back
    expect(layerDrop(rows(), d, a, false)).toEqual({ id: d });
    expect(layerDrop(rows(), a, d, true)).toEqual({ id: a, after: d });
    expect(layerDrop(rows(), a, 'g1' as RecordId, false)).toBeNull();
    expect(layerDrop(rows(), d, 'g1' as RecordId, false)).toEqual({ id: d, after: a });
    // members among themselves; never across into another sibling list
    expect(layerDrop(rows(), b, c, true)).toEqual({ id: b, after: c });
    expect(layerDrop(rows(), b, c, false)).toBeNull();
    expect(layerDrop(rows(), b, d, true)).toBeNull();
    expect(layerDrop(rows(), d, d, true)).toBeNull();
  });

  it('FR-ARR-008: the lock toggle sets position, size, rotation and select together and keeps the other locks', () => {
    const on = toggledLocks({ aspect: true }, true);
    expect(on).toEqual({ aspect: true, position: true, size: true, rotation: true, select: true });
    expect(isLocked(on)).toBe(true);
    expect(isLocked({ position: true })).toBe(false);
    expect(toggledLocks(on, false)).toEqual({ aspect: true });
    expect(toggledLocks({ position: true }, false)).toBeUndefined();
  });
});
