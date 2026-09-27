import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pathCommands, point } from './__fixtures__/arbitraries.js';
import { nearestPoint } from './nearest.js';
import { type Path, pathFromCommands, pointAt } from './path.js';
import { distance, equalsApprox, type Vec2 } from './vec2.js';

function mustPath(result: ReturnType<typeof pathFromCommands>): Path {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Smallest distance from `p` to 98 evenly spaced samples of every segment (a grid unrelated to the implementation's). */
function closestSample(path: Path, p: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  for (const seg of path.segments) for (let k = 0; k <= 97; k++) best = Math.min(best, distance(pointAt(seg, k / 97), p));
  return best;
}

describe('nearestPoint', () => {
  it('projects onto a straight line', () => {
    const path = mustPath(
      pathFromCommands([
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'L', to: { x: 10, y: 0 } },
        { kind: 'L', to: { x: 10, y: 10 } },
      ]),
    );
    const hit = nearestPoint(path, { x: 13, y: 6 });
    expect(hit?.segment).toBe(1);
    expect(hit?.t).toBeCloseTo(0.6, 6);
    expect(equalsApprox(hit?.point ?? { x: Number.NaN, y: 0 }, { x: 10, y: 6 }, 1e-6)).toBe(true);
    expect(hit?.distance).toBeCloseTo(3, 6);
    const end = nearestPoint(path, { x: -5, y: -5 });
    expect(end?.t).toBe(0);
    expect(end?.point).toEqual({ x: 0, y: 0 });
  });

  it('returns null for an empty path', () => {
    expect(nearestPoint({ segments: [], closed: false }, { x: 0, y: 0 })).toBeNull();
  });

  it('FR-CON-001: nearestPoint is on the path and no sampled point is closer', () => {
    fc.assert(
      fc.property(pathCommands, point, (cmds, p) => {
        const path = mustPath(pathFromCommands(cmds));
        const hit = nearestPoint(path, p);
        expect(hit).not.toBeNull();
        if (hit === null) return;
        const seg = path.segments[hit.segment];
        expect(seg).toBeDefined();
        if (seg === undefined) return;
        expect(hit.t).toBeGreaterThanOrEqual(0);
        expect(hit.t).toBeLessThanOrEqual(1);
        expect(equalsApprox(hit.point, pointAt(seg, hit.t), 1e-9)).toBe(true);
        expect(hit.distance).toBeCloseTo(distance(hit.point, p), 9);
        expect(hit.distance).toBeLessThanOrEqual(closestSample(path, p) + 1e-7);
      }),
    );
  }, 120_000);
});
