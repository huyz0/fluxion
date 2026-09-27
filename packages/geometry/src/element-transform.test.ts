import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { coord } from './__fixtures__/arbitraries.js';
import { boxContains, boxInflate } from './box.js';
import { elementBounds, elementCorners, elementMatrix } from './element-transform.js';
import { apply } from './mat2d.js';
import { equalsApprox, type Vec2 } from './vec2.js';

function expectPoints(actual: readonly Vec2[], expected: readonly Vec2[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [i, p] of actual.entries()) expect(equalsApprox(p, expected[i] ?? { x: Number.NaN, y: Number.NaN })).toBe(true);
}

describe('element transform', () => {
  it('without rotation maps local (0,0)..(w,h) onto the placed box', () => {
    const t = { x: 10, y: 20, w: 100, h: 50, rot: 0 };
    expect(apply(elementMatrix(t), { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
    expect(apply(elementMatrix(t), { x: 100, y: 50 })).toEqual({ x: 110, y: 70 });
    expect(elementBounds(t)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it('FR-SHP-001: rotating 90° clockwise about the centre maps corners as expected', () => {
    // box 0..100 × 0..50, centre (50, 25); clockwise on a y-down screen: (dx, dy) → (-dy, dx)
    const corners = elementCorners({ x: 0, y: 0, w: 100, h: 50, rot: 90 });
    expectPoints(corners, [
      { x: 75, y: -25 },
      { x: 75, y: 75 },
      { x: 25, y: 75 },
      { x: 25, y: -25 },
    ]);
    const bounds = elementBounds({ x: 0, y: 0, w: 100, h: 50, rot: 90 });
    expect(bounds.x).toBeCloseTo(25, 9);
    expect(bounds.y).toBeCloseTo(-25, 9);
    expect(bounds.w).toBeCloseTo(50, 9);
    expect(bounds.h).toBeCloseTo(100, 9);
  });

  it('FR-SHP-001: flips mirror about the centre', () => {
    const t = { x: 0, y: 0, w: 100, h: 50, rot: 0 };
    expectPoints(elementCorners({ ...t, flipX: true }), [
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
    expectPoints(elementCorners({ ...t, flipY: true }), [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('FR-SHP-001: rotated bounds contain all 4 corners and the centre stays fixed', () => {
    // whole-pixel sizes and quarter-degree angles: every run is a real, usually rotated box (M2.15 review F2)
    const size = fc.integer({ min: 1, max: 500 });
    const angle = fc.integer({ min: -2880, max: 2880 }).map((q) => q / 4);
    fc.assert(
      fc.property(fc.record({ x: coord, y: coord, w: size, h: size, rot: angle, flipX: fc.boolean(), flipY: fc.boolean() }), (t) => {
        const { x, y, w, h } = t;
        const bounds = boxInflate(elementBounds(t), 1e-9);
        const corners = elementCorners(t);
        for (const c of corners) expect(boxContains(bounds, c)).toBe(true);
        // bounds are tight: each of the four edges is touched by some corner
        const tight = elementBounds(t);
        const xs = corners.map((c) => c.x);
        const ys = corners.map((c) => c.y);
        expect(Math.abs(Math.min(...xs) - tight.x)).toBeLessThan(1e-9);
        expect(Math.abs(Math.max(...xs) - (tight.x + tight.w))).toBeLessThan(1e-9);
        expect(Math.abs(Math.min(...ys) - tight.y)).toBeLessThan(1e-9);
        expect(Math.abs(Math.max(...ys) - (tight.y + tight.h))).toBeLessThan(1e-9);
        expect(equalsApprox(apply(elementMatrix(t), { x: w / 2, y: h / 2 }), { x: x + w / 2, y: y + h / 2 }, 1e-9)).toBe(true);
      }),
    );
  });
});
