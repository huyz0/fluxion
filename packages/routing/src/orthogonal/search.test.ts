import type { Vec2 } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { buildGrid } from './grid.js';
import { type RouteSegment, searchRoute } from './search.js';

const at = (x: number, y: number): Vec2 => ({ x, y });
// vertical lines at 0, 50, 100 (and midlines) and horizontal ones at 0, 50, 100, 150; the wires end at y = 0 and 100
const grid = buildGrid({ obstacles: [], stubs: [at(0, 0), at(50, 50), at(100, 100), at(0, 150), at(100, 150)], margin: 8 });
const input = { grid, obstacles: [], margin: 8, start: at(0, 50), goal: at(100, 50) };
const wire = (x: number): RouteSegment => ({ from: at(x, 0), to: at(x, 100) });

describe('A* crossing cost (FR-CON-004)', () => {
  it('FR-CON-004: a route crosses an earlier wire on a grid line when the detour costs more', () => {
    expect(searchRoute({ ...input, existing: [wire(50)] })).toEqual([at(0, 50), at(100, 50)]);
  });

  it('FR-CON-004: a route goes around an earlier wire on a grid line when crossing costs more', () => {
    const route = searchRoute({ ...input, existing: [wire(50)], crossingCost: 1000 });
    expect(route).toEqual([at(0, 50), at(0, 0), at(100, 0), at(100, 50)]);
  });

  it('FR-CON-004: a wire off the grid is paid for as well', () => {
    const route = searchRoute({ ...input, existing: [wire(12)], crossingCost: 1000 });
    expect(route?.length).toBe(4);
  });

  it('FR-CON-004: running along a wire is not a crossing', () => {
    const along: RouteSegment = { from: at(0, 50), to: at(100, 50) };
    expect(searchRoute({ ...input, existing: [along], crossingCost: 1000 })).toEqual([at(0, 50), at(100, 50)]);
  });
});
