import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pathCommands } from './__fixtures__/arbitraries.js';
import { intersectCubics, intersectPaths, intersectSegments } from './intersections.js';
import { nearestPoint } from './nearest.js';
import { type CubicSegment, derivativeAt, type Path, pathFromCommands, pointAt, splitAt } from './path.js';
import { distance, equalsApprox } from './vec2.js';

function mustPath(result: ReturnType<typeof pathFromCommands>): Path {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const KAPPA = 0.5522847498307936;

/** At most `max` hits, each on the circle of radius `r` about the origin (relative 1e-3). */
function expectOnCircle(hits: readonly { x: number; y: number }[], r: number, max: number): void {
  expect(hits.length, `r = ${r}`).toBeLessThanOrEqual(max);
  for (const h of hits) expect(Math.abs(Math.hypot(h.x, h.y) - r) / r, `r = ${r}`).toBeLessThan(1e-3);
}
const arc: CubicSegment = { p0: { x: 10, y: 0 }, p1: { x: 10, y: 10 * KAPPA }, p2: { x: 10 * KAPPA, y: 10 }, p3: { x: 0, y: 10 } };

describe('intersectSegments', () => {
  it('finds a crossing and rejects misses and parallels', () => {
    expect(
      intersectSegments(
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        [
          { x: 0, y: 10 },
          { x: 10, y: 0 },
        ],
      ),
    ).toEqual({ x: 5, y: 5 });
    const short: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(
      intersectSegments(short, [
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ]),
    ).toBeNull();
    expect(
      intersectSegments(short, [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ]),
    ).toBeNull();
    expect(
      intersectSegments(short, [
        { x: 3, y: 3 },
        { x: 3, y: 3 },
      ]),
    ).toBeNull();
  });
});

describe('intersectCubics', () => {
  it('finds where a line crosses a quarter circle', () => {
    const diagonal: CubicSegment = { p0: { x: 0, y: 0 }, p1: { x: 4, y: 4 }, p2: { x: 8, y: 8 }, p3: { x: 12, y: 12 } };
    const hits = intersectCubics(arc, diagonal);
    expect(hits).toHaveLength(1);
    const r = Math.hypot(hits[0]?.x ?? 0, hits[0]?.y ?? 0);
    expect(Math.abs(r - 10)).toBeLessThan(0.01);
    expect(hits[0]?.x).toBeCloseTo(hits[0]?.y ?? Number.NaN, 6);
  });

  it('finds two crossings sorted by x and none for disjoint curves', () => {
    const chordLine: CubicSegment = { p0: { x: 0, y: 6 }, p1: { x: 4, y: 6 }, p2: { x: 8, y: 6 }, p3: { x: 12, y: 6 } };
    const flat: CubicSegment = { p0: { x: 0, y: 30 }, p1: { x: 4, y: 30 }, p2: { x: 8, y: 30 }, p3: { x: 12, y: 30 } };
    const cap: CubicSegment = { p0: { x: 0, y: 0 }, p1: { x: 3, y: 12 }, p2: { x: 9, y: 12 }, p3: { x: 12, y: 0 } };
    const hits = intersectCubics(cap, chordLine);
    expect(hits).toHaveLength(2);
    expect((hits[0]?.x ?? 0) < (hits[1]?.x ?? 0)).toBe(true);
    // cap is y = 36 t (1 - t) with a control polygon mirrored about x = 6, so the hits are mirror images
    for (const h of hits) expect(h.y).toBeCloseTo(6, 6);
    expect((hits[0]?.x ?? 0) + (hits[1]?.x ?? 0)).toBeCloseTo(12, 6);
    expect(intersectCubics(cap, flat)).toEqual([]);
  });

  it('terminates on a coincident curve and reports only points on it', () => {
    const hits = intersectCubics(arc, arc);
    for (const h of hits) expect(Math.abs(Math.hypot(h.x, h.y) - 10)).toBeLessThan(0.01);
  });

  it('a coincident stretch is not reported point by point, at any size (M2.16 review F1)', () => {
    for (const r of [10, 1000, 1e5]) {
      const big: CubicSegment = { p0: { x: r, y: 0 }, p1: { x: r, y: r * KAPPA }, p2: { x: r * KAPPA, y: r }, p3: { x: 0, y: r } };
      const [firstHalf] = splitAt(big, 0.5);
      // identical arcs report none; a half arc at most the point where it leaves the whole
      expectOnCircle(intersectCubics(big, big), r, 0);
      expectOnCircle(intersectCubics(big, firstHalf), r, 1);
      expectOnCircle(intersectCubics(firstHalf, big), r, 1);
    }
  }, 10_000);

  it('curves running close together but apart are separated quickly (M2.16 review r2 F1)', () => {
    // concentric arcs never cross; before the fat-line test these took seconds each
    for (const r of [1000, 1e4, 1e5])
      for (const gap of [1e-3, 0.1]) {
        const inner: CubicSegment = { p0: { x: r, y: 0 }, p1: { x: r, y: r * KAPPA }, p2: { x: r * KAPPA, y: r }, p3: { x: 0, y: r } };
        const s = (r + gap) / r;
        const outer: CubicSegment = { p0: { x: r * s, y: 0 }, p1: { x: r * s, y: r * s * KAPPA }, p2: { x: r * s * KAPPA, y: r * s }, p3: { x: 0, y: r * s } };
        expect(intersectCubics(inner, outer), `r = ${r}, gap = ${gap}`).toEqual([]);
        expect(intersectCubics(splitAt(inner, 0.5)[0], outer), `r = ${r}, gap = ${gap}`).toEqual([]);
      }
  }, 5_000);
});

describe('intersectPaths', () => {
  it('deduplicates a crossing at a shared segment joint', () => {
    const vee = mustPath(
      pathFromCommands([
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'L', to: { x: 5, y: 5 } },
        { kind: 'L', to: { x: 10, y: 0 } },
      ]),
    );
    const bar = mustPath(
      pathFromCommands([
        { kind: 'M', to: { x: 5, y: 0 } },
        { kind: 'L', to: { x: 5, y: 10 } },
      ]),
    );
    const hits = intersectPaths(vee, bar);
    expect(hits).toHaveLength(1);
    expect(equalsApprox(hits[0] ?? { x: 0, y: 0 }, { x: 5, y: 5 }, 1e-6)).toBe(true);
  });

  it('FR-CON-001: intersection is symmetric and every point lies on both paths', () => {
    fc.assert(
      fc.property(pathCommands, pathCommands, (c1, c2) => {
        const a = mustPath(pathFromCommands(c1));
        const b = mustPath(pathFromCommands(c2));
        const ab = intersectPaths(a, b);
        const ba = intersectPaths(b, a);
        expect(ba).toHaveLength(ab.length);
        for (const [i, p] of ab.entries()) expect(equalsApprox(p, ba[i] ?? { x: Number.NaN, y: 0 }, 1e-9)).toBe(true);
        for (const p of ab) {
          expect(nearestPoint(a, p)?.distance ?? Number.POSITIVE_INFINITY).toBeLessThan(1e-3);
          expect(nearestPoint(b, p)?.distance ?? Number.POSITIVE_INFINITY).toBeLessThan(1e-3);
        }
      }),
    );
  }, 120_000);

  it('FR-CON-001: a line built to cross a curve at a known point finds that point', () => {
    // random curves rarely cross, so symmetry alone could pass with no hits: construct one (M2.16)
    fc.assert(
      fc.property(pathCommands, fc.nat(), fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 50 }), (cmds, pick, tenths, reach) => {
        const path = mustPath(pathFromCommands(cmds));
        const seg = path.segments[pick % path.segments.length];
        if (seg === undefined) return;
        const t = tenths / 10;
        const at = pointAt(seg, t);
        const d = derivativeAt(seg, t);
        const speed = Math.hypot(d.x, d.y);
        fc.pre(speed >= 1);
        // a transversal line through `at`, along the curve's normal
        const n = { x: (-d.y / speed) * reach, y: (d.x / speed) * reach };
        const line = mustPath(
          pathFromCommands([
            { kind: 'M', to: { x: at.x - n.x, y: at.y - n.y } },
            { kind: 'L', to: { x: at.x + n.x, y: at.y + n.y } },
          ]),
        );
        const hits = intersectPaths(path, line);
        expect(Math.min(...hits.map((h) => distance(h, at)))).toBeLessThan(1e-4);
      }),
    );
  }, 120_000);
});
