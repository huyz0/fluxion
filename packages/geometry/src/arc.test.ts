import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arcToCubics } from './arc.js';
import { type CubicSegment, pointAt } from './path.js';
import { distance, type Vec2 } from './vec2.js';

type Ellipse = { cx: number; cy: number; rx: number; ry: number; rotation: number };

/** The ellipse's point at angle `t` (the parametric form, independent of the implementation). */
function on(e: Ellipse, t: number): Vec2 {
  const phi = (e.rotation * Math.PI) / 180;
  const [x, y] = [e.rx * Math.cos(t), e.ry * Math.sin(t)];
  return { x: e.cx + x * Math.cos(phi) - y * Math.sin(phi), y: e.cy + x * Math.sin(phi) + y * Math.cos(phi) };
}

/** How far `p` is from the ellipse, as `|(x/rx)² + (y/ry)² - 1|` in its own frame. */
function offEllipse(e: Ellipse, p: Vec2): number {
  const phi = (e.rotation * Math.PI) / 180;
  const [dx, dy] = [p.x - e.cx, p.y - e.cy];
  const x = Math.cos(phi) * dx + Math.sin(phi) * dy;
  const y = -Math.sin(phi) * dx + Math.cos(phi) * dy;
  return Math.abs((x / e.rx) ** 2 + (y / e.ry) ** 2 - 1);
}

const samples = (segs: readonly CubicSegment[]) => segs.flatMap((s) => Array.from({ length: 11 }, (_, k) => pointAt(s, k / 10)));

/** The segments run from exactly `from` to exactly `to`, each starting where the previous one ends. */
function expectJoined(segs: readonly CubicSegment[], from: Vec2, to: Vec2): void {
  expect(segs[0]?.p0).toBe(from);
  expect(segs.at(-1)?.p3).toBe(to);
  for (const [i, s] of segs.entries()) if (i > 0) expect(s.p0).toBe(segs[i - 1]?.p3);
}

/** A number from `min`/10 to `max`/10, nudged off round values. */
const tenths = (min: number, max: number) => fc.integer({ min, max }).map((n) => n / 10 + 0.037);

describe('arcToCubics (ADR-0016)', () => {
  it('FR-SHP-003: arcs become cubics of at most 90° that stay on their ellipse', () => {
    const sweepAngle = fc.oneof(
      fc.double({ min: 0.1, max: Math.PI - 0.1, noNaN: true }),
      fc.double({ min: Math.PI + 0.1, max: 2 * Math.PI - 0.1, noNaN: true }),
    );
    fc.assert(
      fc.property(
        // tenths off round values: fast-check's doubles favour 0, 1 and the bounds, which hide mistakes
        fc.record({
          cx: tenths(-5000, 5000),
          cy: tenths(-5000, 5000),
          rx: tenths(10, 4000),
          ry: tenths(10, 4000),
          rotation: tenths(-3600, 3600),
        }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        sweepAngle,
        fc.boolean(),
        (e, t0, span, positive) => {
          const delta = positive ? span : -span;
          const from = on(e, t0);
          const to = on(e, t0 + delta);
          const segs = arcToCubics(from, { rx: e.rx, ry: e.ry, rotation: e.rotation, largeArc: span > Math.PI, sweep: positive, to });
          expect(segs.length).toBe(Math.ceil(span / (Math.PI / 2)));
          expectJoined(segs, from, to);
          for (const p of samples(segs)) expect(offEllipse(e, p)).toBeLessThan(2e-3);
          // the arc passes through the ellipse's point halfway along the sweep, not the other way round
          const mid = on(e, t0 + delta / 2);
          expect(Math.min(...samples(segs).map((p) => distance(p, mid)))).toBeLessThan(Math.max(e.rx, e.ry) * 0.2);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('draws a quarter circle as one cubic through the circle', () => {
    const segs = arcToCubics({ x: 10, y: 0 }, { rx: 10, ry: 10, rotation: 0, largeArc: false, sweep: true, to: { x: 0, y: 10 } });
    expect(segs).toHaveLength(1);
    const mid = pointAt(segs[0] as CubicSegment, 0.5);
    expect(mid.x).toBeCloseTo(10 * Math.SQRT1_2, 2);
    expect(mid.y).toBeCloseTo(10 * Math.SQRT1_2, 2);
    // the large arc the other way round is three quarters: three cubics around the centre (10, 10)
    const large = arcToCubics({ x: 10, y: 0 }, { rx: 10, ry: 10, rotation: 0, largeArc: true, sweep: true, to: { x: 0, y: 10 } });
    expect(large).toHaveLength(3);
    for (const p of samples(large)) expect(distance(p, { x: 10, y: 10 })).toBeCloseTo(10, 1);
  });

  it('scales radii that are too small, ignores their sign, and draws degenerate arcs as SVG does', () => {
    // radius 1 between points 10 apart: the smallest ellipse through both, a half circle of radius 5
    const half = arcToCubics({ x: 0, y: 0 }, { rx: 1, ry: -1, rotation: 0, largeArc: false, sweep: true, to: { x: 10, y: 0 } });
    expect(half).toHaveLength(2);
    for (const p of samples(half)) expect(distance(p, { x: 5, y: 0 })).toBeCloseTo(5, 1);
    // sweeping with increasing angle from (0, 0) to (10, 0) turns clockwise on screen: above the chord
    expect(pointAt(half[0] as CubicSegment, 1).y).toBeCloseTo(-5, 6);
    const other = arcToCubics({ x: 0, y: 0 }, { rx: 1, ry: 1, rotation: 0, largeArc: false, sweep: false, to: { x: 10, y: 0 } });
    expect(pointAt(other[0] as CubicSegment, 1).y).toBeCloseTo(5, 6);
    // the same arc from a negative radius
    expect(arcToCubics({ x: 0, y: 0 }, { rx: -5, ry: -5, rotation: 0, largeArc: false, sweep: true, to: { x: 10, y: 0 } })).toEqual(half);
    // radii far too small or far too large stay finite: a half circle, or the chord itself
    const tiny = arcToCubics({ x: 0, y: 0 }, { rx: 1e-300, ry: 1e-300, rotation: 0, largeArc: false, sweep: true, to: { x: 10, y: 0 } });
    expect(tiny).toHaveLength(2);
    for (const p of samples(tiny)) expect(distance(p, { x: 5, y: 0 })).toBeCloseTo(5, 1);
    const flat = arcToCubics({ x: 0, y: 0 }, { rx: 1e-300, ry: 2e-300, rotation: 0, largeArc: false, sweep: true, to: { x: 10, y: 0 } });
    for (const p of samples(flat)) expect(Math.hypot((p.x - 5) / 5, p.y / 10)).toBeCloseTo(1, 2);
    // on a diagonal chord both radii scale by the same factor: the smallest 1:2 ellipse through (0, 0) and (10, 10)
    const a = Math.sqrt(25 + 25 / 4);
    const slanted = arcToCubics({ x: 0, y: 0 }, { rx: 1, ry: 2, rotation: 0, largeArc: false, sweep: true, to: { x: 10, y: 10 } });
    for (const p of samples(slanted)) expect(Math.hypot((p.x - 5) / a, (p.y - 5) / (2 * a))).toBeCloseTo(1, 2);
    expect(arcToCubics({ x: 0, y: 0 }, { rx: 1e300, ry: 1e300, rotation: 0, largeArc: false, sweep: true, to: { x: 9, y: 3 } })).toEqual([
      { p0: { x: 0, y: 0 }, p1: { x: 3, y: 1 }, p2: { x: 6, y: 2 }, p3: { x: 9, y: 3 } },
    ]);
    const vast = arcToCubics({ x: 0, y: 0 }, { rx: 1e150, ry: 1e150, rotation: 30, largeArc: false, sweep: true, to: { x: 10, y: 0 } });
    expect(vast).toHaveLength(1);
    for (const p of samples(vast)) expect(Math.abs(p.y)).toBeLessThan(1e-6);
    // radii whose ratio or centre overflows: the chord, never a non-finite point
    for (const [rx, ry, rotation] of [
      [1e-300, 1e300, 0],
      [1e300, 1e-300, 30],
      [1e-300, 1e300, 45],
      [1e308, 1e308, 10],
    ] as const)
      expect(arcToCubics({ x: 0, y: 0 }, { rx, ry, rotation, largeArc: false, sweep: true, to: { x: 9, y: 3 } }), `${rx} ${ry} ${rotation}`).toEqual([
        { p0: { x: 0, y: 0 }, p1: { x: 3, y: 1 }, p2: { x: 6, y: 2 }, p3: { x: 9, y: 3 } },
      ]);
    // the chord of far-apart points stays finite
    const [far] = arcToCubics({ x: -1e308, y: 0 }, { rx: 1, ry: 1, rotation: 0, largeArc: false, sweep: true, to: { x: 1e308, y: 3e307 } });
    expect([far?.p1.x, far?.p1.y, far?.p2.x, far?.p2.y].map((v) => (v ?? Number.NaN) / 1e307)).toEqual([
      expect.closeTo(-10 / 3, 9),
      expect.closeTo(1, 9),
      expect.closeTo(10 / 3, 9),
      expect.closeTo(2, 9),
    ]);
    // a zero radius is a straight line; equal endpoints draw nothing
    expect(arcToCubics({ x: 0, y: 0 }, { rx: 0, ry: 5, rotation: 0, largeArc: false, sweep: true, to: { x: 9, y: 3 } })).toEqual([
      { p0: { x: 0, y: 0 }, p1: { x: 3, y: 1 }, p2: { x: 6, y: 2 }, p3: { x: 9, y: 3 } },
    ]);
    expect(arcToCubics({ x: 0, y: 0 }, { rx: 5, ry: 0, rotation: 0, largeArc: false, sweep: true, to: { x: 9, y: 3 } })).toHaveLength(1);
    expect(arcToCubics({ x: 4, y: 4 }, { rx: 5, ry: 5, rotation: 0, largeArc: true, sweep: true, to: { x: 4, y: 4 } })).toEqual([]);
    expect(arcToCubics({ x: 4, y: 4 }, { rx: 5, ry: 5, rotation: 0, largeArc: true, sweep: true, to: { x: 4, y: 5 } })).not.toEqual([]);
    expect(arcToCubics({ x: 4, y: 4 }, { rx: 5, ry: 5, rotation: 0, largeArc: true, sweep: true, to: { x: 5, y: 4 } })).not.toEqual([]);
  });
});
