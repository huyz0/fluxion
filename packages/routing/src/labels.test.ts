import type { PathCommand } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { labelPosition, routePoint } from './labels.js';

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

describe('points along a route (FR-CON-003)', () => {
  it('FR-CON-003: a route point carries the direction the route runs there', () => {
    // halfway along the elbow: 100 px down its vertical leg, heading down
    const mid = routePoint(elbow, 0.5);
    expect(mid.point.x).toBeCloseTo(100, 6);
    expect(mid.point.y).toBeCloseTo(100, 6);
    expect(mid.dir.x).toBeCloseTo(0, 6);
    expect(mid.dir.y).toBeCloseTo(1, 6);
    // on the first leg, heading right; fractions past the ends are clamped
    expect(routePoint(elbow, 0.1).dir.x).toBeCloseTo(1, 6);
    expect(routePoint(elbow, 2).dir.y).toBeCloseTo(1, 6);
    expect(routePoint(elbow, -1).point).toEqual({ x: 0, y: 0 });
    expect(routePoint(elbow, -1).dir.x).toBeCloseTo(1, 6);
    // no path: the origin, no direction
    expect(routePoint([], 0.5)).toEqual({ point: { x: 0, y: 0 }, dir: { x: 0, y: 0 } });
  });
});
