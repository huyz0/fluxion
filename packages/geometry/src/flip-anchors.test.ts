// FR-SHP-009: a flip mirrors where an element's anchors land (M19.16). Anchors are fractions of the element's own box placed
// through its matrix (routing's anchor.ts), so the `e` anchor (1, 0.5) of a flipped element lands on its west side, and with a
// turn too.
import { describe, expect, it } from 'vitest';
import { type ElementTransform, elementMatrix } from './element-transform.js';
import { apply } from './mat2d.js';

const box: ElementTransform = { x: 100, y: 50, w: 200, h: 100, rot: 0 };
/** Where the box fraction `(fx, fy)` of `t` lands on screen. */
const at = (t: ElementTransform, fx: number, fy: number) => {
  const p = apply(elementMatrix(t), { x: fx * t.w, y: fy * t.h });
  return { x: Math.round(p.x * 1e9) / 1e9, y: Math.round(p.y * 1e9) / 1e9 };
};

describe('flipped anchors (FR-SHP-009)', () => {
  it('FR-SHP-009: a flipped e anchor resolves to the west side and n to the south under flipY', () => {
    expect(at(box, 1, 0.5)).toEqual({ x: 300, y: 100 });
    expect(at({ ...box, flipX: true }, 1, 0.5)).toEqual({ x: 100, y: 100 });
    expect(at({ ...box, flipX: true }, 0, 0.5)).toEqual({ x: 300, y: 100 });
    expect(at({ ...box, flipY: true }, 0.5, 0)).toEqual({ x: 200, y: 150 });
    // an off-centre anchor mirrors across the centre line: a quarter along the top lands three quarters along
    expect(at({ ...box, flipX: true }, 0.25, 0)).toEqual({ x: 250, y: 50 });
  });

  it('FR-SHP-009: a flipped, turned element mirrors in its own axes: flipX takes the fraction fx to 1 − fx, flipY fy to 1 − fy', () => {
    // turned 90° clockwise about its centre (200, 100): e is at the bottom, flipped it is at the top
    expect(at({ ...box, rot: 90 }, 1, 0.5)).toEqual({ x: 200, y: 200 });
    expect(at({ ...box, rot: 90, flipX: true }, 1, 0.5)).toEqual({ x: 200, y: 0 });
    for (const [fx, fy] of [
      [0.1, 0.9],
      [1, 0],
      [0.5, 0.5],
    ] as const) {
      expect(at({ ...box, rot: 30, flipX: true }, fx, fy)).toEqual(at({ ...box, rot: 30 }, 1 - fx, fy));
      expect(at({ ...box, rot: 30, flipY: true }, fx, fy)).toEqual(at({ ...box, rot: 30 }, fx, 1 - fy));
    }
  });
});
