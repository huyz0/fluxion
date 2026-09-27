import { describe, expect, it } from 'vitest';
import { type Path, pathFromCommands } from './path.js';
import { createPathSampler } from './path-sampler.js';
import { equalsApprox } from './vec2.js';

function mustPath(result: ReturnType<typeof pathFromCommands>): Path {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const KAPPA = 0.5522847498307936;

describe('createPathSampler', () => {
  it('FR-CON-001: the length of a straight line equals its Euclidean length (ε 1e-6)', () => {
    const path = mustPath(
      pathFromCommands([
        { kind: 'M', to: { x: 1, y: 2 } },
        { kind: 'L', to: { x: 31, y: 42 } },
      ]),
    );
    const sampler = createPathSampler(path);
    expect(Math.abs(sampler.length - 50)).toBeLessThanOrEqual(1e-6);
    expect(equalsApprox(sampler.pointAtLength(25), { x: 16, y: 22 }, 1e-9)).toBe(true);
    expect(equalsApprox(sampler.tangentAtLength(10), { x: 0.6, y: 0.8 }, 1e-9)).toBe(true);
  });

  it('FR-CON-001: the length of a cubic quarter circle is within 1e-3 relative of πr/2', () => {
    const r = 100;
    const path = mustPath(
      pathFromCommands([
        { kind: 'M', to: { x: r, y: 0 } },
        { kind: 'C', control1: { x: r, y: r * KAPPA }, control2: { x: r * KAPPA, y: r }, to: { x: 0, y: r } },
      ]),
    );
    const sampler = createPathSampler(path);
    expect(Math.abs(sampler.length - (Math.PI * r) / 2) / ((Math.PI * r) / 2)).toBeLessThanOrEqual(1e-3);
    // halfway along the arc is on the 45° diagonal
    const mid = sampler.pointAtFraction(0.5);
    expect(mid.x).toBeCloseTo(mid.y, 6);
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(r, 1);
  });

  it('clamps lengths and fractions to the path', () => {
    const path = mustPath(
      pathFromCommands([
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'L', to: { x: 10, y: 0 } },
        { kind: 'L', to: { x: 10, y: 10 } },
      ]),
    );
    const sampler = createPathSampler(path, { samplesPerSegment: 4 });
    expect(sampler.length).toBeCloseTo(20, 12);
    expect(sampler.pointAtLength(-5)).toEqual({ x: 0, y: 0 });
    expect(equalsApprox(sampler.pointAtLength(99), { x: 10, y: 10 })).toBe(true);
    expect(equalsApprox(sampler.pointAtLength(15), { x: 10, y: 5 })).toBe(true);
    expect(equalsApprox(sampler.pointAtFraction(2), { x: 10, y: 10 })).toBe(true);
    expect(sampler.pointAtFraction(-1)).toEqual({ x: 0, y: 0 });
    expect(equalsApprox(sampler.tangentAtLength(15), { x: 0, y: 1 })).toBe(true);
  });

  it('an empty path has length 0 and samples to the origin', () => {
    const sampler = createPathSampler({ segments: [], closed: false });
    expect(sampler.length).toBe(0);
    expect(sampler.pointAtLength(3)).toEqual({ x: 0, y: 0 });
    expect(sampler.tangentAtLength(3)).toEqual({ x: 0, y: 0 });
    expect(sampler.pointAtFraction(0.5)).toEqual({ x: 0, y: 0 });
  });

  it('a zero-length segment yields its point and a zero tangent', () => {
    const p = { x: 4, y: 4 };
    const sampler = createPathSampler({ segments: [{ p0: p, p1: p, p2: p, p3: p }], closed: false });
    expect(sampler.length).toBe(0);
    expect(sampler.pointAtLength(0)).toEqual(p);
    expect(sampler.tangentAtLength(0)).toEqual({ x: 0, y: 0 });
  });
});
