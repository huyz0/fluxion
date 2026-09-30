import { nearestPoint, type Path, type PathCommand, pathFromCommands } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distanceWithin, straight } from './outline-distance.js';

const path = (commands: readonly PathCommand[]): Path => {
  const built = pathFromCommands(commands);
  if (!built.ok) throw new Error('bad path');
  return built.value;
};
const rect = path([
  { kind: 'M', to: { x: 0, y: 0 } },
  { kind: 'L', to: { x: 100, y: 0 } },
  { kind: 'L', to: { x: 100, y: 50 } },
  { kind: 'L', to: { x: 0, y: 50 } },
  { kind: 'Z' },
]);
const exact = (p: Path, q: { x: number; y: number }) => nearestPoint(p, q)?.distance ?? Number.POSITIVE_INFINITY;

describe('distance to an outline within a limit (FR-EDT-004)', () => {
  it('FR-EDT-004: straight edges are measured exactly, from inside or outside, at their ends too', () => {
    for (const q of [
      { x: 50, y: 3 },
      { x: 50, y: -7 },
      { x: 120, y: 60 },
      { x: 97, y: 25 },
      { x: -2, y: -2 },
    ])
      expect(distanceWithin(rect, q, 50)).toBeCloseTo(exact(rect, q), 6);
  });

  it('FR-EDT-004: beyond the limit, some distance above it (no segment measured when none is near)', () => {
    expect(distanceWithin(rect, { x: 50, y: 25 }, 5)).toBeGreaterThan(5);
    expect(distanceWithin(rect, { x: 500, y: 500 }, 5)).toBe(Number.POSITIVE_INFINITY);
    // within the limit, the true distance even when a farther segment was skipped
    expect(distanceWithin(rect, { x: 50, y: 4 }, 5)).toBeCloseTo(4, 9);
    expect(distanceWithin({ segments: [], closed: false }, { x: 0, y: 0 }, 5)).toBe(Number.POSITIVE_INFINITY);
  });

  it('FR-EDT-004: a segment is straight (the exact fast path) when both controls lie on its chord', () => {
    // from (10, 20) to (100, 50): the chord's direction is (90, 30)
    const seg = (c1: readonly [number, number], c2: readonly [number, number], b: readonly [number, number] = [100, 50]) => ({
      p0: { x: 10, y: 20 },
      p1: { x: c1[0], y: c1[1] },
      p2: { x: c2[0], y: c2[1] },
      p3: { x: b[0], y: b[1] },
    });
    // a line's cubic: controls at a third and two thirds, anywhere between the ends, or on them
    expect([straight(seg([40, 30], [70, 40])), straight(seg([10, 20], [100, 50])), straight(seg([55, 35], [55, 35]))]).toEqual([true, true, true]);
    // off the chord, or on its line beyond either end
    expect([
      straight(seg([40, 31], [70, 40])),
      straight(seg([40, 30], [71, 40])),
      straight(seg([7, 19], [70, 40])),
      straight(seg([40, 30], [103, 51])),
    ]).toEqual([false, false, false, false]);
    // a control off the chord by floating-point noise (well within its relative tolerance) is on it
    expect(straight(seg([40, 30 + 5e-8], [70, 40]))).toBe(true);
    // vertical and leftward chords
    expect([straight(seg([10, 30], [10, 40], [10, 50])), straight(seg([-20, 20], [-50, 20], [-80, 20]))]).toEqual([true, true]);
    // a chord of no length: straight only with its controls on its one point
    const dot = (c1: readonly [number, number]) => straight(seg(c1, [10, 20], [10, 20]));
    expect([dot([10, 20]), dot([11, 20]), dot([10, 21])]).toEqual([true, false, false]);
  });

  it('FR-EDT-004: on any cubic or straight segment, the distance within the limit is the exact one', () => {
    const pt = fc.record({ x: fc.integer({ min: -100, max: 100 }), y: fc.integer({ min: -100, max: 100 }) });
    // straight segments with their controls on the chord, and curves with them anywhere
    const straight = fc.tuple(pt, pt, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true })).map(([a, b, s, t]) => ({
      a,
      c1: { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s },
      c2: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      b,
    }));
    const curved = fc.record({ a: pt, c1: pt, c2: pt, b: pt });
    fc.assert(
      fc.property(fc.oneof(straight, curved), pt, (s, q) => {
        const seg = path([
          { kind: 'M', to: s.a },
          { kind: 'C', control1: s.c1, control2: s.c2, to: s.b },
        ]);
        expect(distanceWithin(seg, q, 1000)).toBeCloseTo(exact(seg, q), 3);
      }),
    );
  });

  it('FR-EDT-004: curves, and cubics whose controls lie beyond their ends, are measured along the curve', () => {
    const arc = path([
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'C', control1: { x: 0, y: 100 }, control2: { x: 100, y: 100 }, to: { x: 100, y: 0 } },
    ]);
    expect(distanceWithin(arc, { x: 50, y: 60 }, 50)).toBeCloseTo(exact(arc, { x: 50, y: 60 }), 6);
    // collinear controls past the far end: the curve reaches beyond (100, 0)
    const overshoot = path([
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'C', control1: { x: 150, y: 0 }, control2: { x: 150, y: 0 }, to: { x: 100, y: 0 } },
    ]);
    expect(distanceWithin(overshoot, { x: 110, y: 0 }, 50)).toBeCloseTo(exact(overshoot, { x: 110, y: 0 }), 6);
    expect(distanceWithin(overshoot, { x: 110, y: 0 }, 50)).toBeLessThan(1);
    const before = path([
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'C', control1: { x: -50, y: 0 }, control2: { x: -50, y: 0 }, to: { x: 100, y: 0 } },
    ]);
    expect(distanceWithin(before, { x: -10, y: 0 }, 50)).toBeLessThan(1);
    // a segment of no length is a point
    const dot = path([
      { kind: 'M', to: { x: 5, y: 5 } },
      { kind: 'L', to: { x: 5, y: 5 } },
    ]);
    expect(distanceWithin(dot, { x: 8, y: 9 }, 10)).toBeCloseTo(5, 9);
    // the same path twice: measured once, the same answer
    expect(distanceWithin(rect, { x: 50, y: 3 }, 50)).toBe(distanceWithin(rect, { x: 50, y: 3 }, 50));
  });
});
