import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pathCommands } from './__fixtures__/arbitraries.js';
import { boxContains, boxInflate } from './box.js';
import { type CubicSegment, derivativeAt, type Path, pathBounds, pathFromCommands, pointAt, segmentBounds, splitAt } from './path.js';
import { equalsApprox, type Vec2 } from './vec2.js';

function mustPath(result: ReturnType<typeof pathFromCommands>): Path {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 101 evenly spaced points on every segment. */
function samplePath(path: Path): Vec2[] {
  return path.segments.flatMap((seg) => Array.from({ length: 101 }, (_, k) => pointAt(seg, k / 100)));
}

const s: CubicSegment = { p0: { x: 0, y: 0 }, p1: { x: 0, y: 100 }, p2: { x: 100, y: 100 }, p3: { x: 100, y: 0 } };

describe('pathFromCommands', () => {
  it('normalises lines and quadratics to cubics', () => {
    const path = mustPath(
      pathFromCommands([
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'L', to: { x: 30, y: 0 } },
        { kind: 'Q', control: { x: 60, y: 30 }, to: { x: 30, y: 60 } },
      ]),
    );
    expect(path.closed).toBe(false);
    expect(path.segments[0]).toEqual({ p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 }, p2: { x: 20, y: 0 }, p3: { x: 30, y: 0 } });
    const quad = path.segments[1] as CubicSegment;
    // degree elevation keeps the curve: the quadratic midpoint is (a + 2q + b) / 4
    expect(equalsApprox(pointAt(quad, 0.5), { x: 45, y: 30 })).toBe(true);
  });

  it('Z adds a closing line only when the path is not already back at the start', () => {
    const open = mustPath(
      pathFromCommands([
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'L', to: { x: 10, y: 0 } },
        { kind: 'C', control1: { x: 10, y: 5 }, control2: { x: 5, y: 10 }, to: { x: 0, y: 10 } },
        { kind: 'Z' },
      ]),
    );
    expect(open.closed).toBe(true);
    expect(open.segments).toHaveLength(3);
    expect(open.segments[2]?.p3).toEqual({ x: 0, y: 0 });
    const already = mustPath(
      pathFromCommands([{ kind: 'M', to: { x: 0, y: 0 } }, { kind: 'L', to: { x: 10, y: 0 } }, { kind: 'L', to: { x: 0, y: 0 } }, { kind: 'Z' }]),
    );
    expect(already.segments).toHaveLength(2);
  });

  it('FR-CON-001: invalid commands return error Results', () => {
    const code = (r: ReturnType<typeof pathFromCommands>): string => (r.ok ? 'ok' : r.error.code);
    expect(code(pathFromCommands([]))).toBe('PATH_MISSING_MOVE');
    expect(code(pathFromCommands([{ kind: 'L', to: { x: 1, y: 1 } }]))).toBe('PATH_MISSING_MOVE');
    expect(
      code(
        pathFromCommands([
          { kind: 'M', to: { x: 0, y: 0 } },
          { kind: 'L', to: { x: 1, y: 1 } },
          { kind: 'M', to: { x: 5, y: 5 } },
        ]),
      ),
    ).toBe('PATH_MULTIPLE_SUBPATHS');
    expect(code(pathFromCommands([{ kind: 'M', to: { x: 0, y: 0 } }, { kind: 'Z' }, { kind: 'L', to: { x: 1, y: 1 } }]))).toBe('PATH_COMMAND_AFTER_CLOSE');
    expect(
      code(
        pathFromCommands([
          { kind: 'M', to: { x: 0, y: 0 } },
          { kind: 'L', to: { x: Number.NaN, y: 1 } },
        ]),
      ),
    ).toBe('PATH_INVALID_POINT');
    expect(code(pathFromCommands([{ kind: 'M', to: { x: 0, y: Number.POSITIVE_INFINITY } }]))).toBe('PATH_INVALID_POINT');
  });

  it('a lone M is a valid empty path with no bounds', () => {
    const path = mustPath(pathFromCommands([{ kind: 'M', to: { x: 1, y: 1 } }]));
    expect(path.segments).toHaveLength(0);
    expect(pathBounds(path)).toBeNull();
  });
});

describe('cubic segment operations', () => {
  it('evaluates points and derivatives', () => {
    expect(pointAt(s, 0)).toEqual(s.p0);
    expect(pointAt(s, 1)).toEqual(s.p3);
    expect(pointAt(s, 0.5)).toEqual({ x: 50, y: 75 });
    expect(derivativeAt(s, 0)).toEqual({ x: 0, y: 300 });
    expect(derivativeAt(s, 0.5)).toEqual({ x: 150, y: 0 });
  });

  it('splits into halves that trace the same curve', () => {
    const [left, right] = splitAt(s, 0.25);
    expect(left.p3).toEqual(pointAt(s, 0.25));
    expect(right.p0).toEqual(pointAt(s, 0.25));
    expect(equalsApprox(pointAt(left, 0.5), pointAt(s, 0.125))).toBe(true);
    expect(equalsApprox(pointAt(right, 0.5), pointAt(s, 0.625))).toBe(true);
  });

  it('segment bounds are tight at the curve extremum, not the control points', () => {
    expect(segmentBounds(s)).toEqual({ x: 0, y: 0, w: 100, h: 75 });
    // straight horizontal line: both extremum equations are degenerate
    const line: CubicSegment = { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 }, p2: { x: 2, y: 0 }, p3: { x: 3, y: 0 } };
    expect(segmentBounds(line)).toEqual({ x: 0, y: 0, w: 3, h: 0 });
    // x' has a zero quadratic term (linear case) and y' has no real roots
    const bent: CubicSegment = { p0: { x: 0, y: 0 }, p1: { x: 2, y: 1 }, p2: { x: 2, y: 2 }, p3: { x: 0, y: 3 } };
    const b = segmentBounds(bent);
    expect(b.w).toBeCloseTo(1.5, 12);
    expect(b.h).toBe(3);
  });

  it('FR-CON-001: path bbox contains all sampled points and is touched by the curve', () => {
    fc.assert(
      fc.property(pathCommands, (cmds) => {
        const path = mustPath(pathFromCommands(cmds));
        const bounds = pathBounds(path);
        expect(bounds).not.toBeNull();
        if (bounds === null) return;
        const samples = samplePath(path);
        const inflated = boxInflate(bounds, 1e-9);
        expect(samples.filter((p) => !boxContains(inflated, p))).toEqual([]);
        const maxX = Math.max(...samples.map((p) => p.x));
        // tightness: sampling at 1/100 gets within a small fraction of the true extent
        expect(bounds.x + bounds.w - maxX).toBeLessThanOrEqual(1e-2 * Math.max(1, bounds.w));
      }),
    );
  }, 120_000);
});
