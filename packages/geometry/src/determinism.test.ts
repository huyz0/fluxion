import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { matrix, pathCommands, point } from './__fixtures__/arbitraries.js';
import { elementBounds, elementCorners, elementMatrix } from './element-transform.js';
import { intersectPaths } from './intersections.js';
import { invert } from './mat2d.js';
import { nearestPoint } from './nearest.js';
import { pathBounds, pathFromCommands } from './path.js';
import { createPathSampler } from './path-sampler.js';
import { pointInPath } from './point-in-path.js';
import { createDynamicIndex, createStaticIndex } from './spatial-index.js';

/** Every snapshot-style operation of the package on one input, as JSON text. */
function snapshot(
  c1: Parameters<typeof pathFromCommands>[0],
  c2: Parameters<typeof pathFromCommands>[0],
  p: { x: number; y: number },
  m: Parameters<typeof invert>[0],
): string {
  const a = pathFromCommands(c1);
  const b = pathFromCommands(c2);
  if (!a.ok || !b.ok) return JSON.stringify([a, b]);
  const sampler = createPathSampler(a.value);
  const items = [...a.value.segments, ...b.value.segments].map((s, i) => ({
    id: `s${i}`,
    box: { x: Math.min(s.p0.x, s.p3.x), y: Math.min(s.p0.y, s.p3.y), w: Math.abs(s.p3.x - s.p0.x), h: Math.abs(s.p3.y - s.p0.y) },
  }));
  const query = { x: p.x - 20, y: p.y - 20, w: 40, h: 40 };
  const transform = { x: p.x, y: p.y, w: 50, h: 30, rot: 30 };
  return JSON.stringify({
    bounds: pathBounds(a.value),
    length: sampler.length,
    samples: [0, 0.25, 0.5, 1].map((f) => sampler.pointAtFraction(f)),
    nearest: nearestPoint(a.value, p),
    hits: intersectPaths(a.value, b.value),
    inside: [pointInPath(a.value, p), pointInPath(a.value, p, 'evenodd')],
    invert: invert(m),
    element: [elementMatrix(transform), elementBounds(transform), elementCorners(transform)],
    dynamic: createDynamicIndex(items).search(query),
    static: createStaticIndex(items).search(query),
  });
}

describe('determinism (NFR-REL-005)', () => {
  it('NFR-REL-005: repeated runs are identical', () => {
    fc.assert(
      fc.property(pathCommands, pathCommands, point, matrix, (c1, c2, p, m) => {
        // twice in one process: no hidden state, randomness or clock reaches the results
        expect(snapshot(c1, c2, p, m)).toBe(snapshot(c1, c2, p, m));
      }),
    );
  }, 120_000);
});
