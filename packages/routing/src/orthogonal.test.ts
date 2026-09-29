import type { PathCommand, Vec2 } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ORTHOGONAL_STUB, orthogonalRouter } from './orthogonal.js';
import type { RouteEnd } from './router.js';

// small offsets on a 5 px grid as well: tips a stub apart, sharing a coordinate, are where bends go wrong (M5.19 review F2)
const coord = fc.oneof(
  fc.integer({ min: -500, max: 500 }),
  fc.integer({ min: -12, max: 12 }).map((v) => v * 5),
);
const point = fc.record({ x: coord, y: coord });
const AXES = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const end = fc.record({ point, dir: fc.option(fc.constantFrom(...AXES), { nil: undefined }) });

const points = (commands: readonly PathCommand[]) => commands.map((c) => (c.kind === 'Z' ? { x: Number.NaN, y: Number.NaN } : c.to));
const direction = (a: Vec2, b: Vec2): Vec2 => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });
/** Whether `p` lies on the axis-aligned segment `a`-`b`. */
const onSegment = (a: Vec2, b: Vec2, p: Vec2) =>
  (a.x === b.x && p.x === a.x && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)) ||
  (a.y === b.y && p.y === a.y && Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x));
/** Consecutive pairs of `ps`: the segments. */
const legs = (ps: readonly Vec2[]) => ps.slice(1).map((b, k) => [ps[k] as Vec2, b] as const);
/** How often the route turns straight back on itself. */
const uTurns = (ps: readonly Vec2[]) =>
  legs(ps)
    .slice(1)
    .filter(([a, b], k) => {
      const [d1, d2] = [direction(...(legs(ps)[k] as readonly [Vec2, Vec2])), direction(a, b)];
      return d1.x === -d2.x && d1.y === -d2.y;
    }).length;
/** The direction the route leaves its source and the one its target is left toward (backward from the end). */
const endDirections = (ps: readonly Vec2[]) => [direction(ps[0] as Vec2, ps[1] as Vec2), direction(ps.at(-1) as Vec2, ps.at(-2) as Vec2)];
/** The anchor normals, where the ends have them (otherwise whatever the route does). */
const expectedEnds = (source: RouteEnd, target: RouteEnd, ps: readonly Vec2[]) => {
  const [first, last] = endDirections(ps);
  return [source.dir ?? first, target.dir ?? last];
};
const route = (source: RouteEnd, target: RouteEnd, waypoints: readonly Vec2[] = []) =>
  points(orthogonalRouter.route({ source, target, route: { type: 'orthogonal', waypoints } }));

describe('orthogonal routes (FR-CON-002)', () => {
  it('FR-CON-002: orthogonal routes are axis-aligned and leave along the anchor normal', () => {
    fc.assert(
      fc.property(end, end, fc.array(point, { maxLength: 3 }), (source, target, waypoints) => {
        const commands = orthogonalRouter.route({ source, target, route: { type: 'orthogonal', waypoints } });
        const ps = points(commands);
        // from the source to the target, a move then lines
        expect(commands.map((c) => c.kind)).toEqual(['M', ...ps.slice(1).map(() => 'L')]);
        expect([ps[0], ps.at(-1)]).toEqual([source.point, target.point]);
        // every segment is horizontal or vertical and has a length
        expect(legs(ps).every(([a, b]) => (a.x === b.x) !== (a.y === b.y))).toBe(true);
        // the first segment leaves along the source normal, the last arrives against the target's
        expect(endDirections(ps)).toEqual(expectedEnds(source, target, ps));
        // without waypoints the route never turns straight back on itself (over a stub): apart from two ends in one place
        const apart = source.point.x !== target.point.x || source.point.y !== target.point.y;
        if (waypoints.length === 0 && apart) expect(uTurns(ps)).toBe(0);
        // through every waypoint (a corner, or on a straight run)
        for (const w of waypoints) expect(ps.slice(1).some((b, k) => onSegment(ps[k] as Vec2, b, w))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('FR-CON-002: facing ends join with a Z halfway; ends on different axes with one corner; stubs are never doubled back over', () => {
    const e = (x: number, y: number, dir?: Vec2): RouteEnd => ({ point: { x, y }, dir });
    // facing each other across a gap: right, down halfway, right
    expect(route(e(0, 0, { x: 1, y: 0 }), e(200, 100, { x: -1, y: 0 }))).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    // one right, one up (arriving from above): a single corner
    expect(route(e(0, 0, { x: 1, y: 0 }), e(200, 100, { x: 0, y: -1 }))).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ]);
    // the target behind the source: out along the stub, then across halfway, never back over it
    const behind = route(e(200, 0, { x: 1, y: 0 }), e(0, 100, { x: -1, y: 0 }));
    expect(behind).toEqual([
      { x: 200, y: 0 },
      { x: 200 + ORTHOGONAL_STUB, y: 0 },
      { x: 200 + ORTHOGONAL_STUB, y: 50 },
      { x: -ORTHOGONAL_STUB, y: 50 },
      { x: -ORTHOGONAL_STUB, y: 100 },
      { x: 0, y: 100 },
    ]);
    // the corner behind a stub: the other corner
    expect(route(e(0, 0, { x: -1, y: 0 }), e(200, 100, { x: 0, y: 1 }))).toEqual([
      { x: 0, y: 0 },
      { x: -ORTHOGONAL_STUB, y: 0 },
      { x: -ORTHOGONAL_STUB, y: 100 + ORTHOGONAL_STUB },
      { x: 200, y: 100 + ORTHOGONAL_STUB },
      { x: 200, y: 100 },
    ]);
    // vertical ends facing each other: down, across halfway, down
    expect(route(e(0, 0, { x: 0, y: 1 }), e(100, 200, { x: 0, y: -1 }))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
    ]);
    // ends without directions face each other along the longer axis; a diagonal direction snaps
    expect(route(e(0, 0), e(300, 100))).toEqual([
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 100 },
      { x: 300, y: 100 },
    ]);
    expect(route(e(0, 0, { x: 0.3, y: 0.9 }), e(100, 300, { x: -0.1, y: -0.99 }))[1]).toEqual({ x: 0, y: 150 });
    // on one line facing away from each other: a detour two stubs out, above (or left of) the source's stub
    expect(route(e(200, 0, { x: 1, y: 0 }), e(0, 0, { x: -1, y: 0 }))).toEqual([
      { x: 200, y: 0 },
      { x: 200 + ORTHOGONAL_STUB, y: 0 },
      { x: 200 + ORTHOGONAL_STUB, y: -2 * ORTHOGONAL_STUB },
      { x: -ORTHOGONAL_STUB, y: -2 * ORTHOGONAL_STUB },
      { x: -ORTHOGONAL_STUB, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(route(e(0, 200, { x: 0, y: 1 }), e(0, 0, { x: 0, y: -1 }))).toEqual([
      { x: 0, y: 200 },
      { x: 0, y: 200 + ORTHOGONAL_STUB },
      { x: -2 * ORTHOGONAL_STUB, y: 200 + ORTHOGONAL_STUB },
      { x: -2 * ORTHOGONAL_STUB, y: -ORTHOGONAL_STUB },
      { x: 0, y: -ORTHOGONAL_STUB },
      { x: 0, y: 0 },
    ]);
    // a diagonal direction at 45° snaps to the horizontal
    expect(route(e(0, 0, { x: Math.SQRT1_2, y: Math.SQRT1_2 }), e(300, 300, { x: -1, y: 0 }))[1]).toEqual({ x: 150, y: 0 });
    // two ends in one place without directions: out to the right and back
    expect(route(e(5, 5), e(5, 5))).toEqual([
      { x: 5, y: 5 },
      { x: 5 + ORTHOGONAL_STUB, y: 5 },
      { x: 5, y: 5 },
    ]);
  });
  it('FR-CON-002: no orthogonal route turns straight back on itself, for every pair of ends on a 5 px grid', () => {
    // every offset within ±45 px and every pair of anchor directions (or none): the review F1 cases included
    const offsets = Array.from({ length: 19 }, (_, k) => k * 5 - 45);
    const dirs = [...AXES, undefined];
    const cases = offsets
      .flatMap((dx) => offsets.map((dy) => ({ x: dx, y: dy })))
      .filter((t) => t.x !== 0 || t.y !== 0)
      .flatMap((t) =>
        dirs.flatMap((ds) =>
          dirs.map(
            (dt) =>
              [
                { point: { x: 0, y: 0 }, dir: ds },
                { point: t, dir: dt },
              ] as const,
          ),
        ),
      );
    expect(cases).toHaveLength((19 * 19 - 1) * 25);
    for (const [source, target] of cases) {
      const ps = route(source, target);
      expect(uTurns(ps), JSON.stringify({ source, target, ps })).toBe(0);
      expect(endDirections(ps)).toEqual(expectedEnds(source, target, ps));
    }
    // the review's case: a stub apart across, ends on different axes: around below, into the target from below
    expect(route({ point: { x: 0, y: 0 }, dir: { x: 1, y: 0 } }, { point: { x: -45, y: -20 }, dir: { x: 0, y: 1 } })).toEqual([
      { x: 0, y: 0 },
      { x: ORTHOGONAL_STUB, y: 0 },
      { x: ORTHOGONAL_STUB, y: 2 * ORTHOGONAL_STUB },
      { x: -45, y: 2 * ORTHOGONAL_STUB },
      { x: -45, y: -20 },
    ]);
  });

  it('FR-CON-002: orthogonal routes turn once before each waypoint, horizontal first', () => {
    const ps = route({ point: { x: 0, y: 0 }, dir: { x: 1, y: 0 } }, { point: { x: 300, y: 0 }, dir: { x: 0, y: -1 } }, [{ x: 100, y: 100 }]);
    expect(ps).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: -ORTHOGONAL_STUB },
      { x: 300, y: -ORTHOGONAL_STUB },
      { x: 300, y: 0 },
    ]);
    // the source faces the first waypoint (straight up to it), the target the last (straight in from the left)
    const two = route({ point: { x: 0, y: 0 } }, { point: { x: 300, y: 300 } }, [
      { x: 0, y: -100 },
      { x: 300, y: 100 },
      { x: 200, y: 300 },
    ]);
    expect(two.slice(0, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -100 },
    ]);
    expect(two.slice(-2)).toEqual([
      { x: 200, y: 300 },
      { x: 300, y: 300 },
    ]);
  });
});
