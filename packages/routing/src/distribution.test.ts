// FR-ANC-007 and FR-ANC-003: connectors on one side are sorted by the far end and spaced evenly; a side at `maxConnections` spills the next
// connector to the adjacent side nearer its far end.
import type { Box } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { distributeSlots, type SlotEnd } from './distribution.js';

const box: Box = { x: 0, y: 0, w: 100, h: 80 };
const end = (id: string, far: { x: number; y: number }, rest: Partial<SlotEnd> = {}): SlotEnd => ({ id, key: 'a', box, side: 'e', far, ...rest });

describe('distribution along a side (FR-ANC-007, FR-ANC-003)', () => {
  it('FR-ANC-007: three connectors on the east side are spaced evenly, ordered by the far end', () => {
    const slots = distributeSlots([end('low', { x: 400, y: 300 }), end('high', { x: 400, y: 0 }), end('mid', { x: 400, y: 100 })]);
    expect(slots).toEqual([
      { id: 'low', side: 'e', t: 0.75 },
      { id: 'high', side: 'e', t: 0.25 },
      { id: 'mid', side: 'e', t: 0.5 },
    ]);
  });

  it('FR-ANC-007: a lone connector sits in the middle of its side', () => {
    expect(distributeSlots([end('only', { x: 400, y: 10 })])).toEqual([{ id: 'only', side: 'e', t: 0.5 }]);
  });

  it('FR-ANC-007: on the north side the far end is ordered by x', () => {
    const north = (id: string, x: number): SlotEnd => end(id, { x, y: -200 }, { side: 'n' });
    const slots = distributeSlots([north('right', 300), north('left', -50)]);
    expect(slots.map((s) => [s.id, s.t])).toEqual([
      ['right', 2 / 3],
      ['left', 1 / 3],
    ]);
  });

  it('FR-ANC-003: the 4th connector on a side that holds 3 spills to the adjacent side nearer its far end', () => {
    const max = 3;
    const slots = distributeSlots([
      end('a', { x: 400, y: 0 }, { max }),
      end('b', { x: 400, y: 40 }, { max }),
      end('c', { x: 400, y: 80 }, { max }),
      end('d', { x: 400, y: 500 }, { max }),
    ]);
    expect(slots.filter((s) => s.side === 'e').map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(slots[3]).toEqual({ id: 'd', side: 's', t: 0.5 });
  });

  it('FR-ANC-003: elements are counted separately', () => {
    const slots = distributeSlots([end('a', { x: 400, y: 0 }, { max: 1 }), { ...end('b', { x: 400, y: 0 }, { max: 1 }), key: 'other' }]);
    expect(slots.map((s) => s.side)).toEqual(['e', 'e']);
  });

  it('FR-ANC-003: when every side is full the end stays on its own side', () => {
    const slots = distributeSlots([end('a', { x: 400, y: 0 }, { max: 1, side: 'e' }), end('b', { x: 400, y: 0 }, { max: 0 })]);
    expect(slots[1]?.side).toBe('e');
  });
});
