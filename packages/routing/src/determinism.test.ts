import { createRegistry } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { registerBuiltinRouters } from './builtins.js';
import { findJumps } from './jumps.js';
import { placeLabels } from './label-placement.js';
import type { RouteEnd, Router } from './router.js';

const TYPES = ['straight', 'curved', 'polyline', 'orthogonal'] as const;
const coord = fc.integer({ min: -500, max: 500 });
const point: fc.Arbitrary<Vec2> = fc.record({ x: coord, y: coord });
const dir = fc.constantFrom({ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, undefined);
const end: fc.Arbitrary<RouteEnd> = fc.tuple(point, dir).map(([p, d]) => (d === undefined ? { point: p } : { point: p, dir: d }));

const routers = () => {
  const registry = createRegistry<string, Router>('routers');
  registerBuiltinRouters(registry);
  return registry;
};

describe('router determinism (FR-RTE-004)', () => {
  for (const type of TYPES)
    it(`FR-RTE-004: the ${type} router gives the same bytes for the same request, from a fresh registry`, () => {
      fc.assert(
        fc.property(end, end, fc.array(point, { maxLength: 3 }), (source, target, waypoints) => {
          const request = { source, target, route: { type, waypoints } };
          const run = () => JSON.stringify((routers().get(type) as Router).route(request));
          expect(run()).toBe(run());
        }),
        { numRuns: 200, seed: 20260417 },
      );
    });

  it('FR-RTE-004: jumps and label places do not depend on the order of the input', () => {
    const route = (id: string, z: number, pts: [number, number][]) => ({ id, z, revision: '1', points: pts.map(([x, y]) => ({ x, y })) });
    const routes = [
      route('a', 1, [
        [0, 5],
        [10, 5],
      ]),
      route('b', 2, [
        [4, 0],
        [4, 10],
      ]),
      route('c', 3, [
        [6, 0],
        [6, 10],
      ]),
    ];
    expect(JSON.stringify([...findJumps(routes)])).toBe(JSON.stringify([...findJumps([...routes].reverse())]));
    const labels = [
      {
        id: 'l',
        size: { w: 10, h: 6 },
        commands: [
          { kind: 'M' as const, to: { x: 0, y: 0 } },
          { kind: 'L' as const, to: { x: 50, y: 0 } },
        ],
      },
    ];
    expect(JSON.stringify(placeLabels(labels, []))).toBe(JSON.stringify(placeLabels(labels, [])));
  });
});
