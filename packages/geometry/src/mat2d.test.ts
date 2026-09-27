import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { matrix, point } from './__fixtures__/arbitraries.js';
import { apply, determinant, identity, invert, type Mat2d, multiply, rotation, scaling, translate } from './mat2d.js';
import { equalsApprox } from './vec2.js';

function expectMatrixClose(actual: Mat2d, expected: Mat2d, eps: number): void {
  for (const [i, v] of actual.entries()) expect(Math.abs(v - (expected[i] ?? Number.NaN))).toBeLessThanOrEqual(eps);
}

describe('mat2d', () => {
  it('applies translate, scaling and rotation', () => {
    expect(apply(translate(3, -2), { x: 1, y: 1 })).toEqual({ x: 4, y: -1 });
    expect(apply(scaling(2), { x: 1, y: 3 })).toEqual({ x: 2, y: 6 });
    expect(apply(scaling(2, -1), { x: 1, y: 3 })).toEqual({ x: 2, y: -3 });
    expect(equalsApprox(apply(rotation(Math.PI / 2), { x: 1, y: 0 }), { x: 0, y: 1 })).toBe(true);
    expect(apply(identity(), { x: 7, y: 8 })).toEqual({ x: 7, y: 8 });
  });

  it('multiply(m, n) applies n first, then m', () => {
    const m = multiply(translate(10, 0), scaling(2));
    expect(apply(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
    const n = multiply(scaling(2), translate(10, 0));
    expect(apply(n, { x: 1, y: 1 })).toEqual({ x: 22, y: 2 });
  });

  it('computes the determinant', () => {
    expect(determinant([2, 1, 3, 4, 9, 9])).toBe(5);
  });

  it('FR-SHP-001: a singular matrix inverts to an error value', () => {
    const result = invert([1, 2, 2, 4, 5, 6]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MATRIX_SINGULAR');
    expect(invert([Number.NaN, 0, 0, 1, 0, 0]).ok).toBe(false);
  });

  it('inverts a known matrix exactly', () => {
    const inv = invert([2, 0, 0, 4, 10, 20]);
    expect(inv.ok).toBe(true);
    if (inv.ok) expectMatrixClose(inv.value, [0.5, 0, 0, 0.25, -5, -5], 0);
    const r = invert(multiply(translate(3, 4), rotation(Math.PI / 2)));
    expect(r.ok).toBe(true);
    if (r.ok) expectMatrixClose(r.value, [0, -1, 1, 0, -4, 3], 1e-12);
  });

  it('FR-SHP-001: a nearly singular matrix is an error relative to its scale', () => {
    // det 1e-13 on entries of size 1: singular; the same shape scaled up by 1e3 is not
    expect(invert([1, 1, 1, 1 + 1e-13, 0, 0]).ok).toBe(false);
    expect(invert([1e3, 0, 0, 1e-3, 0, 0]).ok).toBe(true);
    // det ≈ 1 passes an absolute 1e-12 test, but on entries of 1e7 it is ~1e-14 of their scale²
    expect(invert([1e7, 1e7, 1e7, 1e7 + 1e-7, 0, 0]).ok).toBe(false);
  });

  it('FR-SHP-001: transform ∘ inverse = identity (ε 1e-9)', () => {
    fc.assert(
      fc.property(matrix, point, (m, p) => {
        const inv = invert(m);
        expect(inv.ok).toBe(true);
        if (!inv.ok) return;
        expectMatrixClose(multiply(m, inv.value), identity(), 1e-9);
        expectMatrixClose(multiply(inv.value, m), identity(), 1e-9);
        expect(equalsApprox(apply(inv.value, apply(m, p)), p, 1e-9)).toBe(true);
      }),
    );
  });
});
