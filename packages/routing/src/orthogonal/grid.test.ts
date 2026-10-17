import { describe, expect, it } from 'vitest';
import { buildGrid } from './grid.js';

const A = { id: 'a', box: { x: 0, y: 0, w: 40, h: 40 } };
const B = { id: 'b', box: { x: 100, y: 20, w: 40, h: 40 } };
const FAR = { id: 'far', box: { x: 1000, y: 1000, w: 10, h: 10 } };

describe('the sparse routing grid (FR-CON-004)', () => {
  it('FR-CON-004: a lone stub gets its own lines and an outline one margin out', () => {
    expect(buildGrid({ obstacles: [], stubs: [{ x: 10, y: 20 }], margin: 10 })).toEqual({ xs: [0, 10, 20], ys: [10, 20, 30] });
    expect(buildGrid({ obstacles: [], stubs: [], margin: 10 })).toEqual({ xs: [], ys: [] });
  });

  it('FR-CON-004: two boxes give lines one margin outside their edges, an outline and a midline in each wide gap', () => {
    expect(buildGrid({ obstacles: [A, B], stubs: [], margin: 10 })).toEqual({
      xs: [-20, -10, 20, 50, 70, 90, 120, 150, 160],
      ys: [-20, -10, 10, 30, 50, 70, 80],
    });
  });

  it('FR-CON-004: a stub adds its lines and a box outside the window shapes nothing', () => {
    const input = { obstacles: [A, B, FAR], stubs: [{ x: 30, y: 30 }], margin: 10, window: { x: -50, y: -50, w: 300, h: 200 } };
    const grid = buildGrid(input);
    expect(grid).toEqual({ xs: [-20, -10, 10, 30, 50, 70, 90, 120, 150, 160], ys: [-20, -10, 10, 30, 50, 70, 80] });
    expect(grid).toEqual(buildGrid({ ...input, obstacles: [A, B] }));
    // with no window the far box counts
    expect(buildGrid({ ...input, window: undefined }).xs).toContain(1020);
  });

  it('FR-RTE-004: the grid does not depend on the order of the obstacles or stubs', () => {
    const stubs = [
      { x: 30, y: 30 },
      { x: 5, y: 90 },
    ];
    const one = buildGrid({ obstacles: [A, B, FAR], stubs, margin: 10 });
    const two = buildGrid({ obstacles: [FAR, B, A], stubs: [...stubs].reverse(), margin: 10 });
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    expect(one.xs).toEqual([...one.xs].sort((p, q) => p - q));
    expect(new Set(one.xs).size).toBe(one.xs.length);
  });
});
