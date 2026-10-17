import type { Box, PathCommand } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type LabelRequest, placeLabels } from './label-placement.js';

const line = (x0: number, y0: number, x1: number, y1: number): PathCommand[] => [
  { kind: 'M', to: { x: x0, y: y0 } },
  { kind: 'L', to: { x: x1, y: y1 } },
];
const label = (id: string, commands: PathCommand[], extra: Partial<LabelRequest> = {}): LabelRequest => ({ id, commands, size: { w: 40, h: 16 }, ...extra });
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('label placement (FR-LAY-004)', () => {
  it('FR-LAY-004: a label sits at the middle of a clear route', () => {
    const [p] = placeLabels([label('a', line(0, 0, 200, 0))], []);
    expect(p).toMatchObject({ t: 0.5, center: { x: 100, y: 0 }, overlap: 0 });
  });

  it('FR-LAY-004: a label moves along its route off a shape at the middle', () => {
    const shape: Box = { x: 80, y: -30, w: 40, h: 60 };
    const [p] = placeLabels([label('a', line(0, 0, 200, 0))], [shape]);
    expect(p?.t).not.toBe(0.5);
    expect(p?.overlap).toBe(0);
    expect(overlaps(p?.box as Box, shape)).toBe(false);
  });

  it('FR-LAY-004: labels of crossing routes keep clear of each other and of the other route', () => {
    const ps = placeLabels([label('a', line(0, 0, 200, 0)), label('b', line(100, -100, 100, 100))], []);
    expect(overlaps(ps[0]?.box as Box, ps[1]?.box as Box)).toBe(false);
    expect(ps.map((p) => p.overlap)).toEqual([0, 0]);
  });

  it('FR-LAY-004: the preferred fraction is tried first', () => {
    expect(placeLabels([label('a', line(0, 0, 200, 0), { preferred: 0.25 })], [])[0]?.t).toBe(0.25);
  });

  it('FR-LAY-004: a route covered everywhere gets its least-overlapping candidate', () => {
    const wall: Box = { x: -10, y: -50, w: 220, h: 100 };
    const [p] = placeLabels([label('a', line(0, 0, 200, 0))], [wall]);
    expect(p?.overlap).toBeGreaterThan(0);
  });

  it('FR-LAY-004: a route that is not a path puts the label at the origin', () => {
    expect(placeLabels([label('a', [])], [])[0]?.center).toEqual({ x: 0, y: 0 });
  });

  it('FR-LAY-004: the same input gives the same places, and no shape overlap when a candidate is free', () => {
    const shape = fc.record({
      x: fc.integer({ min: 0, max: 160 }),
      y: fc.integer({ min: -40, max: 20 }),
      w: fc.integer({ min: 10, max: 40 }),
      h: fc.integer({ min: 10, max: 40 }),
    });
    fc.assert(
      fc.property(fc.array(shape, { maxLength: 2 }), (shapes) => {
        const request = [label('a', line(0, 0, 200, 0))];
        const first = placeLabels(request, shapes);
        expect(placeLabels(request, shapes)).toEqual(first);
        if (first[0]?.overlap === 0) for (const s of shapes) expect(overlaps(first[0]?.box as Box, s)).toBe(false);
      }),
      { numRuns: 200, seed: 20260417 },
    );
  });
});
