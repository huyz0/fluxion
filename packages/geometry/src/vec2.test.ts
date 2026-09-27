import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { point } from './__fixtures__/arbitraries.js';
import { add, cross, distance, dot, equalsApprox, length, lerp, normalize, rotate, scale, sub, vec2 } from './vec2.js';

describe('vec2', () => {
  it('computes basic arithmetic', () => {
    const a = vec2(3, 4);
    const b = vec2(1, -2);
    expect(add(a, b)).toEqual({ x: 4, y: 2 });
    expect(sub(a, b)).toEqual({ x: 2, y: 6 });
    expect(scale(a, 2)).toEqual({ x: 6, y: 8 });
    expect(dot(a, b)).toBe(-5);
    expect(cross(a, b)).toBe(-10);
    expect(length(a)).toBe(5);
    expect(distance(a, b)).toBeCloseTo(Math.hypot(2, 6), 12);
    expect(lerp(a, b, 0.5)).toEqual({ x: 2, y: 1 });
  });

  it('normalizes to unit length and maps the zero vector to zero', () => {
    expect(normalize(vec2(3, 4))).toEqual({ x: 0.6, y: 0.8 });
    expect(normalize(vec2(0, 0))).toEqual({ x: 0, y: 0 });
  });

  it('rotates a quarter turn clockwise on a y-down screen', () => {
    expect(equalsApprox(rotate(vec2(1, 0), Math.PI / 2), vec2(0, 1))).toBe(true);
  });

  it('compares with a tolerance', () => {
    expect(equalsApprox(vec2(1, 1), vec2(1 + 1e-10, 1))).toBe(true);
    expect(equalsApprox(vec2(1, 1), vec2(1, 1.1))).toBe(false);
    expect(equalsApprox(vec2(1, 1), vec2(1, 1.1), 0.2)).toBe(true);
  });

  it('rotation preserves length', () => {
    fc.assert(
      fc.property(point, fc.double({ min: -10, max: 10, noNaN: true }), (v, angle) => {
        expect(length(rotate(v, angle))).toBeCloseTo(length(v), 9);
      }),
    );
  });
});
