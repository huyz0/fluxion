import { createRegistry } from '@fluxion/core';
import { derivativeAt, type PathCommand, pathFromCommands, type Vec2 } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { registerBuiltinRouters } from './builtins.js';
import { curvedRouter, polylineRouter } from './curved.js';
import { type RouteEnd, type Router, straightRouter } from './router.js';

const point = fc.record({ x: fc.double({ min: -1000, max: 1000, noNaN: true }), y: fc.double({ min: -1000, max: 1000, noNaN: true }) });
const direction = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }).map((a) => ({ x: Math.cos(a), y: Math.sin(a) }));
const end = fc.record({ point, dir: fc.option(direction, { nil: undefined }) });

/** The unit tangent of a cubic command leaving `from` (t = 0) or arriving at its end (t = 1). */
function tangent(from: Vec2, c: PathCommand | undefined, t: 0 | 1): Vec2 {
  if (c?.kind !== 'C') throw new Error('a cubic');
  const seg = { p0: from, p1: c.control1, p2: c.control2, p3: c.to };
  const d = derivativeAt(seg, t);
  const n = Math.hypot(d.x, d.y);
  return { x: d.x / n, y: d.y / n };
}

const far = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) > 1;
const toward = (from: RouteEnd, to: Vec2) => {
  const n = Math.hypot(to.x - from.point.x, to.y - from.point.y);
  return { x: (to.x - from.point.x) / n, y: (to.y - from.point.y) / n };
};
const close = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('curved routes (FR-CON-002)', () => {
  it('FR-CON-002: curved routes leave their anchors along the anchor normals', () => {
    fc.assert(
      fc.property(end, end, fc.array(point, { maxLength: 3 }), (source, target, waypoints) => {
        const stops = [source.point, ...waypoints, target.point];
        fc.pre(stops.slice(1).every((p, k) => far(p, stops[k] as Vec2)));
        const commands = curvedRouter.route({ source, target, route: { type: 'curved', waypoints } });
        // one cubic per leg, through every waypoint, ending at the target
        expect(commands[0]).toEqual({ kind: 'M', to: source.point });
        expect(commands.slice(1).map((c) => (c.kind === 'C' ? c.to : undefined))).toEqual(stops.slice(1));
        // leaving along the source normal (toward the next stop without one)
        close(tangent(source.point, commands[1], 0), source.dir ?? toward(source, stops[1] as Vec2));
        // arriving against the target normal (from the previous stop without one)
        const into = target.dir === undefined ? toward({ point: stops.at(-2) as Vec2 }, target.point) : { x: -target.dir.x, y: -target.dir.y };
        close(tangent(stops.at(-2) as Vec2, commands.at(-1), 1), into);
      }),
    );
  });

  it('FR-CON-002: curved legs join smoothly at waypoints (Catmull-Rom tangents) and a coincident end has no direction', () => {
    const commands = curvedRouter.route({
      source: { point: { x: 10, y: 10 }, dir: { x: 1, y: 0 } },
      target: { point: { x: 210, y: 10 }, dir: { x: 0, y: 1 } },
      route: { type: 'curved', waypoints: [{ x: 110, y: 110 }] },
    });
    // at the waypoint both legs run parallel to the chord from the source to the target (not the target's direction)
    close(tangent({ x: 10, y: 10 }, commands[1], 1), { x: 1, y: 0 });
    close(tangent({ x: 110, y: 110 }, commands[2], 0), { x: 1, y: 0 });
    // the control points sit a third of each leg out
    expect((commands[1] as { control1: Vec2 }).control1).toEqual({ x: 10 + Math.hypot(100, 100) / 3, y: 10 });
    // the path is a valid one
    expect(pathFromCommands(commands).ok).toBe(true);
    // two ends in one place without directions: a point-like cubic, no NaN
    const still = curvedRouter.route({ source: { point: { x: 5, y: 5 } }, target: { point: { x: 5, y: 5 } }, route: { type: 'curved' } });
    expect(still).toEqual([
      { kind: 'M', to: { x: 5, y: 5 } },
      { kind: 'C', control1: { x: 5, y: 5 }, control2: { x: 5, y: 5 }, to: { x: 5, y: 5 } },
    ]);
    // a waypoint on top of its neighbours has no Catmull-Rom tangent either
    const stacked = curvedRouter.route({
      source: { point: { x: 0, y: 0 } },
      target: { point: { x: 0, y: 0 } },
      route: { type: 'curved', waypoints: [{ x: 0, y: 0 }] },
    });
    expect(JSON.stringify(stacked)).not.toContain('null');
  });
});

describe('polyline routes (FR-CON-002)', () => {
  it('FR-CON-002: polyline routes pass through their waypoints', () => {
    fc.assert(
      fc.property(end, end, fc.array(point, { maxLength: 5 }), (source, target, waypoints) => {
        expect(polylineRouter.route({ source, target, route: { type: 'polyline', waypoints } })).toEqual([
          { kind: 'M', to: source.point },
          ...waypoints.map((to) => ({ kind: 'L', to })),
          { kind: 'L', to: target.point },
        ]);
      }),
    );
    // without waypoints: a straight line
    expect(polylineRouter.route({ source: { point: { x: 0, y: 0 } }, target: { point: { x: 1, y: 1 } }, route: { type: 'polyline' } })).toHaveLength(2);
  });

  it('FR-RTE-001: curved and polyline are built in', () => {
    const routers = createRegistry<string, Router>('routers');
    registerBuiltinRouters(routers);
    expect(['straight', 'curved', 'polyline'].map((type) => [routers.get(type), routers.source(type)])).toEqual([
      [straightRouter, 'core'],
      [curvedRouter, 'core'],
      [polylineRouter, 'core'],
    ]);
  });
});
