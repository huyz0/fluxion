import { describe, expect, it } from 'vitest';
import { circle, rect } from '../__fixtures__/boolean-shapes.js';
import { elementMatrix } from '../element-transform.js';
import type { Vec2 } from '../vec2.js';
import { corners, fitRing } from './fit.js';
import { flattenRing, liesFlat, turnsLittle } from './flatten.js';
import { booleanPlacement, sinCosDegrees } from './place.js';
import { area2, inRing, nonzeroParts, simpleLoops } from './rings.js';

const P = (x: number, y: number): Vec2 => ({ x, y });

describe('boolean flattening (ADR-0053 step 2)', () => {
  it('FR-SHP-010: a circle of r = 10 inside a 1000 px operation flattens to at least 36 chords, each turning at most 10°', () => {
    const ring = flattenRing(circle(0, 0, 10).segments, 1000);
    expect(ring.length).toBeGreaterThanOrEqual(36);
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [a, b, c] = [ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]] as [Vec2, Vec2, Vec2];
      const turn = Math.abs(Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)));
      expect(turn).toBeLessThanOrEqual((10.5 * Math.PI) / 180);
    }
  });

  it('FR-SHP-010: a straight segment is one chord; a degenerate one adds nothing', () => {
    expect(flattenRing(rect(0, 0, 100, 50).segments, 100)).toEqual([P(0, 0), P(100, 0), P(100, 50), P(0, 50)]);
    expect(flattenRing([{ p0: P(1, 1), p1: P(1, 1), p2: P(1, 1), p3: P(1, 1) }], 100)).toEqual([]);
  });

  it('FR-SHP-010: the turn test is the squared cosine of 10°, both sides of it, and the flatness test measures off the chord', () => {
    const turned = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return { p0: P(0, 0), p1: P(1, 0), p2: P(2, 0), p3: P(2 + Math.cos(r), Math.sin(r)) };
    };
    expect(turnsLittle(turned(9.9))).toBe(true);
    expect(turnsLittle(turned(10.1))).toBe(false);
    expect(turnsLittle(turned(170))).toBe(false);
    expect(turnsLittle({ p0: P(0, 0), p1: P(0, 0), p2: P(0, 0), p3: P(0, 0) })).toBe(true);
    // a tangent from a control point on the end falls back to the next control point
    expect(turnsLittle({ p0: P(0, 0), p1: P(0, 0), p2: P(1, 0), p3: P(2, 0) })).toBe(true);
    expect(liesFlat({ p0: P(0, 0), p1: P(1, 0.5), p2: P(2, -0.5), p3: P(3, 0) }, 0.5)).toBe(true);
    expect(liesFlat({ p0: P(0, 0), p1: P(1, 0.6), p2: P(2, 0), p3: P(3, 0) }, 0.5)).toBe(false);
    // a chord of no length measures from its start
    expect(liesFlat({ p0: P(0, 0), p1: P(0.3, 0), p2: P(0, 0.3), p3: P(0, 0) }, 0.5)).toBe(true);
    expect(liesFlat({ p0: P(0, 0), p1: P(1, 0), p2: P(0, 0), p3: P(0, 0) }, 0.5)).toBe(false);
  });
});

describe('boolean rings (ADR-0053 step 3)', () => {
  const square = (x: number, y: number, s: number): Vec2[] => [P(x, y), P(x + s, y), P(x + s, y + s), P(x, y + s)];

  it('FR-SHP-010: signed area and containment of a ring', () => {
    expect(area2(square(0, 0, 10))).toBe(200);
    expect(area2([...square(0, 0, 10)].reverse())).toBe(-200);
    expect(inRing(square(0, 0, 10), P(5, 5))).toBe(true);
    expect(inRing(square(0, 0, 10), P(15, 5))).toBe(false);
  });

  it('FR-SHP-010: a figure eight splits into its two oppositely wound lobes; a simple ring is its own loop', () => {
    const eight = [P(0, 0), P(10, 10), P(10, 0), P(0, 10)];
    const loops = simpleLoops(eight);
    expect(loops).toHaveLength(2);
    expect(loops.map((l) => Math.sign(area2(l))).sort()).toEqual([-1, 1]);
    expect(simpleLoops(square(0, 0, 10))).toEqual([square(0, 0, 10)]);
  });

  it('FR-SHP-010: nonzero parts: a same-wound inner ring fills, a counter-wound one is a hole, nested deeper rings refill', () => {
    const outer = square(0, 0, 100);
    const inner = square(25, 25, 50);
    // winding 2 inside: the outer ring less the inner, and the inner, together the whole square
    expect(nonzeroParts([outer, inner])).toEqual([[outer, inner], [inner]]);
    const hole = [...square(25, 25, 50)].reverse();
    const island = square(40, 40, 20);
    const parts = nonzeroParts([outer, hole, island]);
    // the outer ring less its hole, and the island inside the hole
    expect(parts).toEqual([[outer, hole], [island]]);
  });

  it('FR-SHP-010: corners are turns over 30°; a ring without one is cut at its first point; a fit stays within its tolerance', () => {
    expect(corners(square(0, 0, 10))).toEqual([0, 1, 2, 3]);
    const round = flattenRing(circle(0, 0, 100).segments, 200);
    expect(corners(round)).toEqual([0]);
    const fitted = fitRing(
      round,
      round.map(() => 0.4),
    );
    expect(fitted.length).toBeLessThanOrEqual(16);
    expect(fitted.every((s) => [s.p0, s.p3].every((p) => Math.abs(Math.hypot(p.x, p.y) - 100) < 0.5))).toBe(true);
    expect(fitRing(square(0, 0, 10), [0.1, 0.1, 0.1, 0.1])).toHaveLength(4);
  });

  it('FR-SHP-010: a ring whose one corner is not its first point keeps that corner sharp (M19.18 r2 F1)', () => {
    // a teardrop: a circle of radius 100 sampled every 5° from its bottom round to the tangent points at 120° and 240°, with its tip at (0, -200)
    const at = (deg: number) => P(100 * Math.sin((deg * Math.PI) / 180), 100 * Math.cos((deg * Math.PI) / 180));
    const arc = (from: number, to: number) => Array.from({ length: (to - from) / 5 + 1 }, (_, i) => at(from + 5 * i));
    const tip = P(0, -200);
    const ring = [...arc(0, 120), tip, ...arc(240, 355)];
    expect(corners(ring)).toEqual([25]);
    const fitted = fitRing(
      ring,
      ring.map(() => 0.4),
    );
    const unitOf = (v: Vec2) => {
      const l = Math.sqrt(v.x * v.x + v.y * v.y);
      return P(v.x / l, v.y / l);
    };
    const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
    const first = fitted[0];
    const last = fitted[fitted.length - 1];
    if (first === undefined || last === undefined) throw new Error('no fit');
    expect(first.p0).toEqual(tip);
    // the curve leaves the tip towards the 240° tangent point and arrives from the 120° one, not along a smooth tangent
    expect(dot(unitOf(P(first.p1.x - tip.x, first.p1.y - tip.y)), unitOf(P(at(240).x - tip.x, at(240).y - tip.y)))).toBeGreaterThan(0.99);
    expect(dot(unitOf(P(tip.x - last.p2.x, tip.y - last.p2.y)), unitOf(P(tip.x - at(120).x, tip.y - at(120).y)))).toBeGreaterThan(0.99);
  });
});

describe('boolean placement (ADR-0053 step 1, M19 cp1 F4)', () => {
  it('FR-SHP-010: the series sine and cosine agree with Math to 4e-15 and are exact at quarter turns', () => {
    for (let deg = -720; deg <= 720; deg += 7.5) {
      const [s, c] = sinCosDegrees(deg);
      expect(Math.abs(s - Math.sin((deg * Math.PI) / 180))).toBeLessThan(4e-15);
      expect(Math.abs(c - Math.cos((deg * Math.PI) / 180))).toBeLessThan(4e-15);
    }
    expect(sinCosDegrees(90).map((v) => v + 0)).toEqual([1, 0]);
    expect(sinCosDegrees(-180).map((v) => v + 0)).toEqual([0, -1]);
  });

  it('FR-SHP-010: the placement is elementMatrix, turn and flips included', () => {
    const t = { x: 10, y: 20, w: 100, h: 50, rot: 30, flipX: true };
    const a = booleanPlacement(t);
    const b = elementMatrix(t);
    for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i] as number, 12);
  });
});
