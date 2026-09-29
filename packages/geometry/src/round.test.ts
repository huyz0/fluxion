import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CubicSegment, type PathCommand, pathBounds, pathFromCommands, pointAt } from './path.js';
import { roundCorners } from './round.js';
import { distance } from './vec2.js';

const M = (x: number, y: number): PathCommand => ({ kind: 'M', to: { x, y } });
const L = (x: number, y: number): PathCommand => ({ kind: 'L', to: { x, y } });
const Z: PathCommand = { kind: 'Z' };
const square = [M(0, 0), L(100, 0), L(100, 100), L(0, 100), Z];
const arcs = (cmds: readonly PathCommand[]) => cmds.filter((c) => c.kind === 'C') as Extract<PathCommand, { kind: 'C' }>[];
/** `cmds` with every coordinate rounded to 1e-9, for exact comparison. */
const snap = (cmds: readonly PathCommand[]) => JSON.parse(JSON.stringify(cmds, (_, v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 + 0 : v)));
const path = (cmds: readonly PathCommand[]) => {
  const r = pathFromCommands(cmds);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

/** A regular n-gon rounded to `radius` stays one continuous closed subpath inside the original, one arc per corner. */
function expectRoundedInside(n: number, radius: number): void {
  const cmds: PathCommand[] = Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    return { kind: k === 0 ? 'M' : 'L', to: { x: 100 + 90 * Math.cos(a), y: 100 + 90 * Math.sin(a) } } as PathCommand;
  });
  cmds.push(Z);
  const rounded = path(roundCorners(cmds, radius));
  expect(rounded.closed).toBe(true);
  const gaps = rounded.segments.slice(1).map((s, k) => distance(s.p0, rounded.segments[k]?.p3 as never));
  expect(Math.max(0, ...gaps)).toBeLessThan(1e-9);
  const [box, original] = [pathBounds(rounded), pathBounds(path(cmds))];
  expect(box?.x).toBeGreaterThanOrEqual((original?.x ?? 0) - 1e-9);
  expect((box?.x ?? 0) + (box?.w ?? 0)).toBeLessThanOrEqual((original?.x ?? 0) + (original?.w ?? 0) + 1e-9);
  expect(arcs(roundCorners(cmds, radius))).toHaveLength(n);
}

describe('roundCorners (ADR-0019, FR-SHP-004, FR-CON-005)', () => {
  it('FR-SHP-004: every corner of a closed polygon becomes an arc of the radius, tangent to its sides', () => {
    const rounded = snap(roundCorners(square, 10));
    expect(rounded[0]).toEqual(M(10, 0));
    expect(rounded.at(-1)).toEqual(Z);
    expect(arcs(rounded)).toHaveLength(4);
    // the first corner, (100, 0): from 10 before it to 10 after it, on the circle around (90, 10)
    const [first] = arcs(rounded);
    expect(rounded[1]).toEqual(L(90, 0));
    expect(first?.to).toEqual({ x: 100, y: 10 });
    const seg: CubicSegment = { p0: { x: 90, y: 0 }, p1: first?.control1 as never, p2: first?.control2 as never, p3: first?.to as never };
    for (const t of [0.25, 0.5, 0.75]) expect(distance(pointAt(seg, t), { x: 90, y: 10 })).toBeCloseTo(10, 2);
    // tangent to both sides: the first control point lies on the top side, the second on the right side
    expect(first?.control1.y).toBeCloseTo(0, 12);
    expect(first?.control2.x).toBeCloseTo(100, 12);
    // one closed subpath, still inside the square
    const p = path(rounded);
    expect(p.closed).toBe(true);
    expect(pathBounds(p)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('FR-CON-005: a radius larger than half a segment stops at half of it; open paths round only inner corners', () => {
    // a 20-long side caps the tangent distance at 10 on each corner that touches it
    const thin = snap(roundCorners([M(0, 0), L(20, 0), L(20, 100), L(0, 100), Z], 50));
    expect(thin[0]).toEqual(M(10, 0));
    expect(thin[1]).toEqual(L(10, 0));
    // side lengths come from both coordinates: a 20-tall side away from the axis caps at 10 too
    const low = snap(roundCorners([M(0, 50), L(100, 50), L(100, 70), L(0, 70), Z], 50));
    expect(low[1]).toEqual(L(90, 50));
    // a closing line that differs from the start in x only is drawn and rounded
    expect(arcs(roundCorners([M(0, 0), L(0, 100), L(100, 0), Z], 5))).toHaveLength(3);
    // an open elbow: the ends stay, the bend rounds
    const elbow = snap(roundCorners([M(0, 0), L(100, 0), L(100, 100)], 20));
    expect(elbow).toEqual([M(0, 0), L(80, 0), arcs(elbow)[0], L(100, 100)]);
    expect(arcs(elbow)[0]?.to).toEqual({ x: 100, y: 20 });
    // a sharper corner (45°) keeps the radius: its tangent points lie farther from the corner
    const sharp = roundCorners([M(0, 0), L(100, 0), L(0, 100)], 10);
    const enter = sharp[1] as Extract<PathCommand, { kind: 'L' }>;
    expect(distance(enter.to, { x: 100, y: 0 })).toBeCloseTo(10 / Math.tan(Math.PI / 8), 9);
  });

  it('leaves curves, straight-through joins and a zero radius alone', () => {
    // a join with a curve is not rounded; the curve itself is kept
    const curve: PathCommand = { kind: 'C', control1: { x: 150, y: 0 }, control2: { x: 150, y: 100 }, to: { x: 100, y: 100 } };
    const mixed = roundCorners([M(0, 0), L(100, 0), curve, L(0, 100), Z], 10);
    expect(mixed).toContainEqual(curve);
    expect(mixed[1]).toEqual(L(100, 0));
    const quad: PathCommand = { kind: 'Q', control: { x: 50, y: -50 }, to: { x: 100, y: 0 } };
    expect(roundCorners([M(0, 0), quad, L(100, 100)], 10)).toEqual([M(0, 0), quad, L(100, 100)]);
    // collinear points and a doubled point make no arc
    expect(arcs(roundCorners([M(0, 0), L(50, 0), L(100, 0)], 10))).toEqual([]);
    expect(arcs(roundCorners([M(0, 0), L(50, 0), L(50, 0), L(50, 50)], 10))).toEqual([]);
    // a U-turn has no corner to round either
    expect(arcs(roundCorners([M(0, 0), L(50, 0), L(0, 0)], 10))).toEqual([]);
    for (const r of [0, -5, Number.NaN]) expect(roundCorners(square, r)).toBe(square);
    expect(roundCorners([], 5)).toEqual([]);
    expect(roundCorners([L(1, 1)], 5)).toEqual([L(1, 1)]);
    expect(roundCorners([M(3, 4)], 5)).toEqual([M(3, 4)]);
    // a closed path already back at its start draws no closing line; its start corner still rounds
    const back = roundCorners([M(0, 0), L(100, 0), L(100, 100), L(0, 0), Z], 10);
    expect(arcs(back)).toHaveLength(3);
    expect(path(back).closed).toBe(true);
  });

  it('FR-SHP-004: rounded convex polygons stay one continuous subpath inside the original', () => {
    fc.assert(fc.property(fc.integer({ min: 3, max: 12 }), fc.integer({ min: 1, max: 80 }), expectRoundedInside));
  });
});
