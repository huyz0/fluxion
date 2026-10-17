// FR-CON-011: connectors between the same pair of elements are numbered and given offsets `spacing` apart, and each route kind moves
// aside by its offset so the connectors stay at least `spacing` apart.
import type { Vec2 } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { orthogonalRouter } from './orthogonal.js';
import { fanOrthogonal, fanWaypoint, parallelOffsets } from './parallel.js';

const p = (x: number, y: number): Vec2 => ({ x, y });

describe('parallel connectors (FR-CON-011)', () => {
  it('FR-CON-011: two connectors between A and B get offsets spacing apart around zero', () => {
    const offsets = parallelOffsets(
      [
        { id: 'x', a: 'A', b: 'B' },
        { id: 'y', a: 'A', b: 'B' },
      ],
      12,
    );
    expect([offsets.get('x'), offsets.get('y')]).toEqual([-6, 6]);
  });

  it('FR-CON-011: a connector alone gets no offset, and the pair is unordered', () => {
    const offsets = parallelOffsets(
      [
        { id: 'x', a: 'A', b: 'B' },
        { id: 'y', a: 'B', b: 'A' },
        { id: 'z', a: 'A', b: 'C' },
      ],
      10,
    );
    expect(offsets.has('z')).toBe(false);
    expect([offsets.get('x'), offsets.get('y')]).toEqual([-5, 5]);
  });

  it('FR-CON-011: three connectors are centred: -s, 0, +s', () => {
    const edges = ['x', 'y', 'z'].map((id) => ({ id, a: 'A', b: 'B' }));
    expect([...parallelOffsets(edges, 8).values()]).toEqual([-8, 0, 8]);
  });

  it('FR-CON-011: an orthogonal Z moves its middle segment by the offset and keeps its ends', () => {
    const z = [p(0, 0), p(50, 0), p(50, 100), p(150, 100), p(150, 200)];
    const out = fanOrthogonal(z, 10);
    expect(out[0]).toEqual(z[0]);
    expect(out.at(-1)).toEqual(z.at(-1));
    expect(out[2]).toEqual(p(60, 100));
  });

  it('FR-CON-011: two fanned copies of one Z are spacing apart', () => {
    const z = [p(0, 0), p(50, 0), p(50, 100), p(150, 100), p(150, 200)];
    const [a, b] = [fanOrthogonal(z, -6), fanOrthogonal(z, 6)];
    expect(Math.abs((a[2] as Vec2).x - (b[2] as Vec2).x)).toBe(12);
  });

  it('FR-CON-011: a Z and the same Z run backwards, fanned by different offsets, are spacing apart', () => {
    const z = [p(0, 0), p(50, 0), p(50, 150), p(150, 150), p(150, 200)];
    const [forward, backward] = [fanOrthogonal(z, -6), fanOrthogonal([...z].reverse(), 6)];
    expect(Math.abs((forward[1] as Vec2).x - (backward[2] as Vec2).x)).toBe(12);
  });

  it('FR-CON-011: a tie between two longest inner segments is broken the same way in both directions', () => {
    const z = [p(0, 0), p(50, 0), p(50, 100), p(150, 100), p(150, 200)];
    const [forward, backward] = [fanOrthogonal(z, 10), fanOrthogonal([...z].reverse(), 10)];
    expect((forward[1] as Vec2).x).toBe(60);
    expect((backward[3] as Vec2).x).toBe(60);
  });

  it('FR-CON-011: a shift that would fold a neighbour back leaves the route as it was', () => {
    const z = [p(0, 0), p(50, 0), p(50, 5), p(150, 5), p(150, 200)];
    expect(fanOrthogonal(z, -10)).toEqual(z);
  });

  it('FR-CON-011: two A to B connectors routed by the orthogonal router stay spacing apart once fanned', () => {
    const commands = orthogonalRouter.route({
      source: { point: p(100, 40), dir: p(1, 0) },
      target: { point: p(300, 200), dir: p(-1, 0) },
      route: { type: 'orthogonal', waypoints: [] },
    });
    const points = commands.flatMap((c) => (c.kind === 'Z' ? [] : [c.to]));
    const [a, b] = [fanOrthogonal(points, -6), fanOrthogonal(points, 6)];
    const xs = (r: Vec2[]) => r.filter((q, i) => i > 0 && r[i - 1]?.x === q.x && r[i - 1]?.y !== q.y).map((q) => q.x);
    expect(Math.abs((xs(a)[0] as number) - (xs(b)[0] as number))).toBe(12);
  });

  it('FR-CON-011: a straight run jogs to the same side whichever way it runs', () => {
    const back = fanOrthogonal([p(200, 0), p(0, 0)], 10);
    expect([back[2]?.y, back[3]?.y]).toEqual([10, 10]);
  });

  it('FR-CON-011: a straight run gets a jog out of each stub', () => {
    const out = fanOrthogonal([p(0, 0), p(200, 0)], 10);
    expect(out).toEqual([p(0, 0), p(20, 0), p(20, 10), p(180, 10), p(180, 0), p(200, 0)]);
  });

  it('FR-CON-011: a zero offset returns the route as it was', () => {
    const z = [p(0, 0), p(50, 0), p(50, 100), p(150, 100), p(150, 200)];
    expect(fanOrthogonal(z, 0)).toEqual(z);
  });

  it('FR-CON-011: a curved connector bows through a waypoint beside the chord, mirrored for the other sign', () => {
    const [a, b] = [p(0, 0), p(100, 0)];
    expect(fanWaypoint(a, b, 0)).toEqual(p(50, 0));
    expect(fanWaypoint(a, b, 10)).toEqual(p(50, 10));
    expect(fanWaypoint(a, b, -10)).toEqual(p(50, -10));
    expect(fanWaypoint(b, a, 10)).toEqual(p(50, 10));
  });
});
