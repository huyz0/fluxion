import { pathBounds, pointAt, type Vec2 } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { evaluateOutline } from './outline.js';
import type { ShapeDef } from './shape-def.js';

const def = (outline: ShapeDef['outline'], extra: Partial<ShapeDef> = {}): ShapeDef => ({
  id: 'test:shape',
  outline,
  defaultSize: { w: 100, h: 50 },
  ...extra,
});
const size = { w: 100, h: 50 };

const outline = (d: ShapeDef, params: { readonly [key: string]: unknown } = {}, s = size) => {
  const r = evaluateOutline(d, s, params);
  if (!r.ok) throw new Error(`${r.error.code} ${r.error.path} ${r.error.message}`);
  return r.value;
};
const problem = (d: ShapeDef, params: { readonly [key: string]: unknown } = {}, budget?: { steps: number }) => {
  const r = evaluateOutline(d, size, params, budget);
  return r.ok ? 'ok' : `${r.error.code} ${r.error.path} ${r.error.message}`;
};
/** The end point of every segment, rounded for comparison. */
const ends = (d: ShapeDef, params: { readonly [key: string]: unknown } = {}) =>
  outline(d, params).path.segments.map((s) => [Math.round(s.p3.x * 1e6) / 1e6, Math.round(s.p3.y * 1e6) / 1e6]);

describe('evaluateOutline: points outlines (ADR-0016)', () => {
  it('FR-SHP-003: a points outline follows the element’s vertices, straight or smooth, open or closed', () => {
    const params: ShapeDef['params'] = {
      v: {
        type: 'points',
        min: 2,
        max: 5,
        default: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
    };
    const open = def({ points: 'v' }, { params });
    expect(outline(open).path.closed).toBe(false);
    expect(
      outline(open)
        .commands.map((c) => c.kind)
        .join(''),
    ).toBe('MLL');
    expect(ends(open)).toEqual([
      [100, 0],
      [100, 50],
    ]);
    expect(ends(def({ points: 'v', closed: true }, { params }))).toEqual([
      [100, 0],
      [100, 50],
      [0, 0],
    ]);
    expect(
      ends(open, {
        v: [
          [0.5, 0.5],
          [2, -1],
        ],
      }),
    ).toEqual([[100, 0]]);
    expect(
      outline(open, {
        v: [
          [0.5, 0.5],
          [2, -1],
        ],
      }).commands[0],
    ).toEqual({ kind: 'M', to: { x: 50, y: 25 } });
    // malformed or outside the spec's count: the default
    for (const bad of [
      [[0, 0]],
      [[0, 0], [1]],
      [
        [0, 0],
        ['1', 1],
      ],
      [
        [0, 0],
        [1, Number.NaN],
      ],
      'v',
      Array(6).fill([0, 0]),
      [
        [0, 0],
        [1, 1, 1],
      ],
    ])
      expect(ends(open, { v: bad }), JSON.stringify(bad)).toEqual(ends(open));
    expect(problem(open, { v: Array(10_001).fill([0, 0]) })).toBe('FLX_SHAPE_LIMIT /params/v 10001 points; at most 10000');
    const wide = def(
      { points: 'v' },
      {
        params: {
          v: {
            type: 'points',
            default: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      },
    );
    expect(outline(wide, { v: Array(10_000).fill([0.5, 0.5]) }).commands).toHaveLength(10_000);
    // smooth: a Catmull-Rom curve through every vertex
    const smooth = def({ points: 'v', smooth: true }, { params });
    const through = (d: ShapeDef): Vec2[] => outline(d).path.segments.map((s) => s.p3);
    expect(through(smooth)).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
    const [first, second] = outline(smooth).path.segments;
    // ends repeat their vertex: the first tangent is (P1 - P0) / 6, the last (P2 - P1) / 6
    expect(first?.p1).toEqual({ x: 100 / 6, y: 0 });
    expect(second?.p2).toEqual({ x: 100, y: 50 - 50 / 6 });
    // P1 is the box's corner: (P2 - P0) / 6 points out of it both ways, so the stroke turns there
    expect(first?.p2).toEqual({ x: 100, y: 0 });
    expect(second?.p1).toEqual({ x: 100, y: 0 });
    // inside the box, one tangent serves both sides of a vertex (C1), scaled until it fits
    const wave = outline(smooth, {
      v: [
        [0, 0.5],
        [0.5, 0.5],
        [0.95, 0.1],
        [1, 0.9],
      ],
    }).path.segments;
    const joint = (k: number) => {
      const [into, out] = [wave[k - 1], wave[k]];
      return {
        before: { x: (into?.p3.x ?? 0) - (into?.p2.x ?? 0), y: (into?.p3.y ?? 0) - (into?.p2.y ?? 0) },
        after: { x: (out?.p1.x ?? 0) - (out?.p0.x ?? 0), y: (out?.p1.y ?? 0) - (out?.p0.y ?? 0) },
      };
    };
    // at (50, 25): the full tangent (P2 - P0) / 6 = (95/6, -20/6), the same on both sides
    expect(joint(1).before.x).toBeCloseTo(95 / 6, 12);
    expect(joint(1).after.x).toBeCloseTo(joint(1).before.x, 12);
    expect(joint(1).after.y).toBeCloseTo(joint(1).before.y, 12);
    // at (95, 5): (P3 - P1) / 6 = (50/6, 20/6) would leave the box to the right (95 + 8.3 > 100): scaled to fit
    expect(joint(2).after.x).toBeCloseTo(5, 12);
    expect(joint(2).after.y).toBeCloseTo(2, 12);
    expect(joint(2).before.x).toBeCloseTo(5, 12);
    expect(joint(2).before.y).toBeCloseTo(2, 12);
    // a vertex on the top edge whose tangent points out of the box runs along the edge, still C1
    const top = outline(smooth, {
      v: [
        [0, 0.2],
        [0.5, 0],
        [1, 0.1],
      ],
    }).path.segments;
    expect(top[0]?.p2.y).toBe(0);
    expect(top[1]?.p1.y).toBe(0);
    expect((top[1]?.p1.x ?? 0) - 50).toBeCloseTo(50 - (top[0]?.p2.x ?? 0), 12);
    expect((top[1]?.p1.x ?? 0) - 50).toBeCloseTo(100 / 6, 12);
    const loop = def({ points: 'v', smooth: true, closed: true }, { params });
    expect(outline(loop).path.closed).toBe(true);
    expect(through(loop)).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 0 },
    ]);
    // closed: the first tangent wraps to the last vertex, (P1 - P2) / 6 = (0, -50/6); P0 is the box's
    // corner, so it points out on one side and the loop turns there, on both of its segments
    expect(outline(loop).path.segments[0]?.p1).toEqual({ x: 0, y: 0 });
    expect(outline(loop).path.segments[2]?.p2).toEqual({ x: 0, y: 0 });
    // an open end uses its tangent on one side only: pointing into the box, it is kept
    const end = outline(smooth, {
      v: [
        [0, 0],
        [1, 1],
      ],
    }).path.segments[0];
    expect(end?.p1).toEqual({ x: 100 / 6, y: 50 / 6 });
    expect(end?.p2).toEqual({ x: 100 - 100 / 6, y: 50 - 50 / 6 });
    // a stroke turning at an edge of its box stays inside it (M5.11 review F1)
    const turn = outline(smooth, {
      v: [
        [0, 1],
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    const controls = turn.path.segments.flatMap((s) => [s.p1, s.p2]);
    expect(controls.filter((p) => p.x < 0 || p.x > 100 || p.y < 0 || p.y > 50)).toEqual([]);
    expect(turn.path.segments.map((s) => s.p3)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(Math.min(...controls.map((p) => p.y))).toBe(0);
    expect(Math.max(...controls.map((p) => p.x))).toBe(100);
  });
});
