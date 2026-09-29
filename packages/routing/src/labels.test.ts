import type { PathCommand } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { labelPosition } from './labels.js';

const elbow: PathCommand[] = [
  { kind: 'M', to: { x: 0, y: 0 } },
  { kind: 'L', to: { x: 100, y: 0 } },
  { kind: 'L', to: { x: 100, y: 300 } },
];

describe('connector label placement (FR-CON-006)', () => {
  it('FR-CON-006: a label sits at its fraction of the route length, moved by its offset', () => {
    // 400 px long: the midpoint is 100 px down the vertical leg, not the corner
    const mid = labelPosition(elbow, 0.5);
    expect(mid.x).toBeCloseTo(100, 6);
    expect(mid.y).toBeCloseTo(100, 6);
    expect(labelPosition(elbow, 0)).toEqual({ x: 0, y: 0 });
    const end = labelPosition(elbow, 1, { x: 5, y: -8 });
    expect(end.x).toBeCloseTo(105, 6);
    expect(end.y).toBeCloseTo(292, 6);
    // a quarter: along the first leg
    expect(labelPosition(elbow, 0.25).x).toBeCloseTo(100, 6);
    expect(labelPosition(elbow, 0.125).x).toBeCloseTo(50, 6);
    // fractions outside 0..1 are clamped to the ends
    expect(labelPosition(elbow, -1)).toEqual({ x: 0, y: 0 });
    expect(labelPosition(elbow, 2).y).toBeCloseTo(300, 6);
    // no path: the offset from the origin
    expect(labelPosition([], 0.5, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });
});
