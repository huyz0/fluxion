import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { matrix, point } from './__fixtures__/arbitraries.js';
import {
  boxCenter,
  boxContains,
  boxContainsBox,
  boxCorners,
  boxFromPoints,
  boxInflate,
  boxIntersection,
  boxIntersects,
  boxUnion,
  transformBox,
} from './box.js';
import { apply, rotation } from './mat2d.js';

const a = { x: 0, y: 0, w: 10, h: 10 };
const b = { x: 5, y: 5, w: 10, h: 10 };
const far = { x: 20, y: 20, w: 1, h: 1 };

describe('box', () => {
  it('builds from points; empty input gives null', () => {
    expect(boxFromPoints([])).toBeNull();
    expect(
      boxFromPoints([
        { x: 3, y: -1 },
        { x: -2, y: 4 },
        { x: 1, y: 1 },
      ]),
    ).toEqual({ x: -2, y: -1, w: 5, h: 5 });
  });

  it('unions, intersects and contains', () => {
    expect(boxUnion(a, b)).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(boxIntersects(a, b)).toBe(true);
    expect(boxIntersects(a, far)).toBe(false);
    expect(boxIntersection(a, b)).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(boxIntersection(a, far)).toBeNull();
    expect(boxContains(a, { x: 10, y: 0 })).toBe(true);
    expect(boxContains(a, { x: 10.1, y: 0 })).toBe(false);
    expect(boxContainsBox(boxUnion(a, b), b)).toBe(true);
    expect(boxContainsBox(a, b)).toBe(false);
  });

  it('inflates, shrinks without going negative, and finds the centre', () => {
    expect(boxInflate(a, 1)).toEqual({ x: -1, y: -1, w: 12, h: 12 });
    expect(boxInflate(a, 1, 2)).toEqual({ x: -1, y: -2, w: 12, h: 14 });
    expect(boxInflate(a, -20)).toEqual({ x: 5, y: 5, w: 0, h: 0 });
    expect(boxCenter(b)).toEqual({ x: 10, y: 10 });
  });

  it('lists corners clockwise from top-left', () => {
    expect(boxCorners({ x: 1, y: 2, w: 3, h: 4 })).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 6 },
      { x: 1, y: 6 },
    ]);
  });

  it('transformBox of a 45° rotation widens a unit square to its diagonal', () => {
    const r = transformBox(rotation(Math.PI / 4), { x: 0, y: 0, w: 1, h: 1 });
    expect(r.w).toBeCloseTo(Math.SQRT2, 12);
    expect(r.h).toBeCloseTo(Math.SQRT2, 12);
  });

  it('FR-SHP-001: transformBox contains every transformed interior point', () => {
    fc.assert(
      fc.property(matrix, point, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (m, p, u, v) => {
        const box = { x: p.x, y: p.y, w: 50, h: 20 };
        const q = apply(m, { x: box.x + u * box.w, y: box.y + v * box.h });
        expect(boxContains(boxInflate(transformBox(m, box), 1e-6), q)).toBe(true);
      }),
    );
  });
});
