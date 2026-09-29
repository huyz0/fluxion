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

const rounded = def(
  { path: 'M {r} 0 H {w - r} A {r} {r} 0 0 1 {w} {r} V {h - r} A {r} {r} 0 0 1 {w - r} {h} H {r} A {r} {r} 0 0 1 0 {h - r} V {r} A {r} {r} 0 0 1 {r} 0 Z' },
  { params: { r: { type: 'number', min: 0, max: 25, default: 10 } } },
);

describe('evaluateOutline (ADR-0016)', () => {
  it('FR-SHP-003: a ShapeDef outline evaluates to a normalized cubic path', () => {
    const o = outline(rounded);
    expect(o.path.closed).toBe(true);
    expect(o.commands[0]).toEqual({ kind: 'M', to: { x: 10, y: 0 } });
    expect(o.commands.at(-1)).toEqual({ kind: 'Z' });
    // 4 edges and 4 quarter arcs, each one cubic; the close adds nothing (the pen is back at the start)
    expect(o.path.segments).toHaveLength(8);
    for (const [k, s] of o.path.segments.entries()) if (k > 0) expect(s.p0).toEqual(o.path.segments[k - 1]?.p3);
    const box = pathBounds(o.path);
    expect(box?.x).toBeCloseTo(0, 9);
    expect(box?.y).toBeCloseTo(0, 9);
    expect(box?.w).toBeCloseTo(100, 9);
    expect(box?.h).toBeCloseTo(50, 9);
    // the corner arc passes at the radius from its centre
    const corner = pointAt(o.path.segments[1] as never, 0.5);
    expect(Math.hypot(corner.x - 90, corner.y - 10)).toBeCloseTo(10, 2);
    // an open template has no Z and stays open
    const line = outline(def({ path: 'M 0 {h} L {w} 0' }));
    expect(line.path.closed).toBe(false);
    expect(line.path.segments).toHaveLength(1);
  });

  it('draws every command letter, repeats a command over extra numbers and turns an M’s extra pairs into lines', () => {
    expect(ends(def({ path: 'M 0 0 H 10 V 20 L 5 5 C 1 1 2 2 3 3 Q 4 4 6 6' }))).toEqual([
      [10, 0],
      [10, 20],
      [5, 5],
      [3, 3],
      [6, 6],
    ]);
    expect(outline(def({ path: 'M 0 0 C 1 1 2 2 3 3 Q 4 4 6 6' })).commands).toEqual([
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'C', control1: { x: 1, y: 1 }, control2: { x: 2, y: 2 }, to: { x: 3, y: 3 } },
      { kind: 'Q', control: { x: 4, y: 4 }, to: { x: 6, y: 6 } },
    ]);
    expect(ends(def({ path: 'M 0 0 1 1, 2 2 L 3 3 4 4 H 7 8 V 9 10' }))).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [7, 4],
      [8, 4],
      [8, 9],
      [8, 10],
    ]);
    expect(outline(def({ path: 'M 0 0 1 1' })).commands[1]?.kind).toBe('L');
    // numbers: signs, fractions, exponents; expressions in braces
    expect(ends(def({ path: 'M -1 +2 L .25 1e1 L 12.5 0 L {w / 4} {-h}' }))).toEqual([
      [0.25, 10],
      [12.5, 0],
      [25, -50],
    ]);
    // Z closes back to the start; an arc between equal points draws nothing and keeps the pen
    expect(ends(def({ path: 'M 5 5 H 9 A 3 3 0 0 1 9 5 V 7 Z' }))).toEqual([
      [9, 5],
      [9, 7],
      [5, 5],
    ]);
    const arcs = outline(def({ path: 'M 0 0 A 10 10 0 1 1 0 20' }));
    expect(arcs.path.segments).toHaveLength(2);
    expect(arcs.commands.slice(1).every((c) => c.kind === 'C')).toBe(true);
    expect(outline(def({ path: 'M 0 0 A 10 10 0 {1} {0} 20 0' })).path.segments.at(-1)?.p3).toEqual({ x: 20, y: 0 });
    // the arc flags are any non-zero number
    const flagged = (flags: string) => outline(def({ path: `M 0 0 A 10 10 0 ${flags} 20 0` })).path.segments[0]?.p1.y;
    expect(flagged('0 2')).toBeLessThan(0);
    expect(flagged('0 0')).toBeGreaterThan(0);
    expect(outline(def({ path: 'M 0 0 A 10 10 0 3 1 0 10' })).path.segments.length).toBe(4);
    expect(outline(def({ path: 'M 0 0 A 10 10 0 0 1 0 10' })).path.segments.length).toBe(1);
    expect(outline(def({ path: 'M 0 0 A 10 10 90 0 1 20 0' })).path.segments[0]?.p0).toEqual({ x: 0, y: 0 });
  });

  it('FR-SHP-003: params are clamped into their ranges and fall back to their defaults', () => {
    expect(outline(rounded, { r: 40 }).commands[0]).toEqual({ kind: 'M', to: { x: 25, y: 0 } });
    expect(outline(rounded, { r: -3 }).commands[0]).toEqual({ kind: 'M', to: { x: 0, y: 0 } });
    for (const bad of ['7', null, Number.NaN, Number.POSITIVE_INFINITY, {}])
      expect(outline(rounded, { r: bad }).commands[0]).toEqual({ kind: 'M', to: { x: 10, y: 0 } });
    // only the element's own keys count
    expect(outline(rounded, Object.create({ r: 20 })).commands[0]).toEqual({ kind: 'M', to: { x: 10, y: 0 } });
    const params: ShapeDef['params'] = {
      k: { type: 'int', min: 1, max: 9, default: 3 },
      e: { type: 'enum', values: ['a', 'b', 'c'], default: 'b' },
      x: { type: 'number', default: 1.5 },
    };
    const probe = def({ path: 'M {k} {e} L {x} 0' }, { params });
    expect(outline(probe).commands.slice(0, 2)).toEqual([
      { kind: 'M', to: { x: 3, y: 1 } },
      { kind: 'L', to: { x: 1.5, y: 0 } },
    ]);
    expect(outline(probe, { k: 4.6, e: 'c', x: -1e6 }).commands.slice(0, 2)).toEqual([
      { kind: 'M', to: { x: 5, y: 2 } },
      { kind: 'L', to: { x: -1e6, y: 0 } },
    ]);
    expect(outline(probe, { k: 100, e: 'z' }).commands[0]).toEqual({ kind: 'M', to: { x: 9, y: 1 } });
    expect(outline(probe, { k: -100, e: 0 }).commands[0]).toEqual({ kind: 'M', to: { x: 1, y: 1 } });
    expect(outline(probe, { e: 'a' }).commands[0]).toEqual({ kind: 'M', to: { x: 3, y: 0 } });
    const last = def({ path: 'M {e} 0' }, { params: { e: { type: 'enum', values: ['a', 'b', 'c'], default: 'c' } } });
    expect(outline(last, { e: 1 }).commands[0]).toEqual({ kind: 'M', to: { x: 2, y: 0 } });
    // a points param is not an identifier of the expressions
    const pts = def(
      { path: 'M {p} 0' },
      {
        params: {
          p: {
            type: 'points',
            default: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      },
    );
    expect(problem(pts)).toBe('FLX_EXPR_UNKNOWN /outline/path unknown name "p" at 0 in "p"');
    expect(outline(def({ path: 'M {pi} 0' })).commands[0]).toEqual({ kind: 'M', to: { x: Math.PI, y: 0 } });
  });

  it('FR-SHP-003: a polygon outline has n vertices evaluated for i = 0 … n-1', () => {
    const hexagon = def({ polygon: { n: '6', x: 'w/2 + w/2 * cos(2*pi*i/n)', y: 'h/2 + h/2 * sin(2*pi*i/n)' } });
    const o = outline(hexagon);
    expect(o.path.closed).toBe(true);
    expect(o.commands.map((c) => c.kind).join('')).toBe('MLLLLLZ');
    expect(o.path.segments).toHaveLength(6);
    expect(o.commands[0]).toEqual({ kind: 'M', to: { x: 100, y: 25 } });
    const star = def(
      { polygon: { n: '2 * points', x: 'i', y: 'i % 2 ? inner : 1' } },
      { params: { points: { type: 'int', min: 3, max: 64, default: 5 }, inner: { type: 'number', default: 0.5 } } },
    );
    expect(outline(star).path.segments).toHaveLength(10);
    expect(outline(star, { points: 8 }).path.segments).toHaveLength(16);
    expect(outline(star).commands[3]).toEqual({ kind: 'L', to: { x: 3, y: 0.5 } });
    expect(outline(def({ polygon: { n: '2', x: 'i', y: '0' } })).path.segments).toHaveLength(2);
    expect(outline(def({ polygon: { n: '1024', x: 'i', y: '0' } })).path.segments).toHaveLength(1024);
    for (const n of ['1', '1025', '2.5', '-3'])
      expect(problem(def({ polygon: { n, x: 'i', y: '0' } }))).toBe(
        `FLX_SHAPE_LIMIT /outline/polygon/n n is ${Number(n)}; it must be an integer from 2 to 1024`,
      );
    expect(problem(def({ polygon: { n: '3', x: 'j', y: '0' } }))).toBe('FLX_EXPR_UNKNOWN /outline/polygon/x unknown name "j" at 0 in "j"');
    expect(problem(def({ polygon: { n: '3', x: '0', y: 'i +' } }))).toBe(
      'FLX_EXPR_SYNTAX /outline/polygon/y expected a number, a name or "(" at 3, found "end" in "i +"',
    );
    expect(problem(def({ polygon: { n: 'i', x: '0', y: '0' } }))).toMatch(/^FLX_EXPR_UNKNOWN \/outline\/polygon\/n /);
    expect(problem(def({ polygon: { n: '2 +', x: '0', y: '0' } }))).toMatch(/^FLX_EXPR_SYNTAX \/outline\/polygon\/n /);
    expect(problem(def({ polygon: { n: '3', x: '(', y: '0' } }))).toMatch(/^FLX_EXPR_SYNTAX \/outline\/polygon\/x /);
    expect(problem(def({ polygon: { n: '3', x: '0', y: 'j' } }))).toMatch(/^FLX_EXPR_UNKNOWN \/outline\/polygon\/y /);
  });

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
    const first = outline(smooth).path.segments[0];
    // ends repeat: the first tangent is (P1 - P0) / 6, the next one (P2 - P0) / 6
    expect(first?.p1).toEqual({ x: 100 / 6, y: 0 });
    // (P2 - P0) / 6 would put the control above the box, (100 - 100/6, -50/6): it is clamped to the box
    expect(first?.p2).toEqual({ x: 100 - 100 / 6, y: 0 });
    expect(outline(smooth).path.segments[1]?.p2).toEqual({ x: 100, y: 50 - 50 / 6 });
    // (P2 - P0) / 6 from P1: x clamped to the box, y inside it
    expect(outline(smooth).path.segments[1]?.p1).toEqual({ x: 100, y: 50 / 6 });
    const loop = def({ points: 'v', smooth: true, closed: true }, { params });
    expect(outline(loop).path.closed).toBe(true);
    expect(through(loop)).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 0 },
    ]);
    // closed: the first tangent wraps to the last vertex, (P1 - P2) / 6
    expect(outline(loop).path.segments[0]?.p1).toEqual({ x: 0, y: 0 }); // (0, -50/6), clamped
    expect(outline(loop).path.segments[2]?.p2).toEqual({ x: 0 - (100 - 100) / 6, y: 0 - (0 - 50) / 6 });
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

  it('FR-SHP-003: decorations are evaluated with the outline, stroke-only paths in order', () => {
    const cylinder = def(
      { path: 'M 0 {e} V {h - e} A {w/2} {e} 0 0 0 {w} {h - e} V {e} A {w/2} {e} 0 0 0 0 {e} Z' },
      { params: { e: { type: 'number', default: 5 } }, decorations: [{ path: 'M 0 {e} A {w/2} {e} 0 0 0 {w} {e}' }, { path: 'M 0 0 L 1 1 Z' }] },
    );
    const o = outline(cylinder);
    expect(o.decorations).toHaveLength(2);
    expect(o.decorations[0]?.closed).toBe(false);
    expect(o.decorations[0]?.segments.at(-1)?.p3).toEqual({ x: 100, y: 5 });
    expect(o.decorations[1]?.closed).toBe(true);
    expect(outline(def({ path: 'M 0 0' })).decorations).toEqual([]);
    expect(problem(def({ path: 'M 0 0' }, { decorations: [{ path: 'M 0 0' }, { path: 'M {q} 0' }] }))).toBe(
      'FLX_EXPR_UNKNOWN /decorations/1/path unknown name "q" at 0 in "q"',
    );
  });

  it('FR-SHP-003: a template that is not one subpath of absolute commands is a diagnostic', () => {
    const cases: [string, string][] = [
      ['M 0 0 l 1 1', 'relative command "l" at 6: write it as absolute "L" in path template'],
      ['M 0 0 X 1 1', 'unexpected "X" at 6 in path template'],
      ['M 0 0 L 1 1 # 3', 'unexpected "#" at 12 in path template'],
      ['0 0 L 1 1', 'expected a command letter at 0, found a number in path template'],
      ['L 1 1', 'a path template starts with "M" in path template'],
      ['', 'a path template starts with "M" in path template'],
      ['M 0 0 L 1 1 M 2 2', 'a second "M" at 12 starts another subpath; an outline is one subpath in path template'],
      ['M 0 0 L 1 1 Z L 2 2', '"L" at 14 follows "Z"; nothing may follow a close in path template'],
      ['M 0 0 L 1 1 Z Z', '"Z" at 14 follows "Z"; nothing may follow a close in path template'],
      ['M 0 0 L 1', '"L" at 6 takes numbers in groups of 2, got 1 in path template'],
      ['M 0 0 L', '"L" at 6 takes numbers in groups of 2, got 0 in path template'],
      ['M 0 0 C 1 2 3 4 5 6 7', '"C" at 6 takes numbers in groups of 6, got 7 in path template'],
      ['M 0 0 Z 1', '"Z" at 6 takes no numbers, got 1 in path template'],
      ['M 0 0 L {w 1', '"{" at 8 is not closed in path template'],
      ['M 0 0 L 1e999 0', 'number "1e999" at 8 is not finite in path template'],
    ];
    for (const [path, message] of cases) expect(problem(def({ path })), path).toBe(`FLX_SHAPE_PATH /outline/path ${message}`);
    expect(problem(def({ path: 'M 0 0 L {w +} 0' }))).toBe(
      'FLX_EXPR_SYNTAX /outline/path expected a number, a name or "(" at 3, found "end" in "w +" (the {…} at 8)',
    );
    expect(problem(def({ path: 'M 0 0 L {} 0' }))).toBe('FLX_EXPR_SYNTAX /outline/path expected a number, a name or "(" at 0, found "end" (the {…} at 8)');
    expect(problem(def({ path: 'M 0 0 L {1/0} 0' }))).toBe('FLX_EXPR_DOMAIN /outline/path division by zero in "1/0"');
    // arcs with extreme radii still draw: a half circle, or the chord
    expect(outline(def({ path: 'M 0 0 A 1e-300 1e-300 0 0 1 10 0' })).path.segments).toHaveLength(2);
    expect(outline(def({ path: 'M 0 0 A 1e300 1e300 0 0 1 10 0' })).path.segments).toHaveLength(1);
    expect(outline(def({ path: 'M 0 0 A {a} 1 0 0 1 10 0' }, { params: { a: { type: 'number', default: 1 } } }), { a: 1e300 }).path.segments).toHaveLength(1);
    expect(outline(def({ path: 'M 0 0 A 1e-300 1e300 30 0 1 10 0' })).path.segments).toHaveLength(1);
    // finite numbers that overflow once combined: a diagnostic, never a throw or an infinite point
    for (const path of ['M -1e308 0 L 1e308 0', 'M 0 0 Q 1e308 0 -1e308 0 Z', 'M -1e308 0 A 1 1 0 0 1 1e308 0 L -1e308 0'])
      expect(problem(def({ path })), path).toBe('FLX_SHAPE_LIMIT /outline a coordinate overflows the number range; keep the numbers of the outline smaller');
    expect(problem(def({ path: 'M 0 0' }, { decorations: [{ path: 'M -1e308 0 L 1e308 0' }] }))).toMatch(/^FLX_SHAPE_LIMIT \/decorations\/0\/path /);
    expect(problem(def({ path: 'M -1e308 0 L 0 0' }))).toBe('ok');
    // an arc between far-apart points is its chord, drawn without overflow
    expect(problem(def({ path: 'M -1e308 0 A 1 1 0 0 1 1e308 0' }))).toBe('ok');
  });

  it('FR-SHP-003: segment caps and one shared step budget bound the work', () => {
    const lines = (k: number) => `M 0 0${' L 1 1'.repeat(k)}`;
    expect(outline(def({ path: lines(1024) })).path.segments).toHaveLength(1024);
    expect(problem(def({ path: lines(1025) }))).toBe('FLX_SHAPE_LIMIT /outline/path the template has 1025 segments; at most 1024 in path template');
    // arcs expand after parsing: 342 half turns are 684 cubics, 513 are 1026
    const arcs = (k: number) => `M 0 0${' A 5 5 0 0 1 10 0 A 5 5 0 0 1 0 0'.repeat(k / 2)}${k % 2 ? ' A 5 5 0 0 1 10 0' : ''}`;
    expect(outline(def({ path: arcs(512) })).path.segments).toHaveLength(1024);
    expect(problem(def({ path: arcs(513) }))).toBe('FLX_SHAPE_LIMIT /outline/path the template expands to 1026 segments; at most 1024');
    // the default budget is 100 000 steps: 1024 vertices of two 47-node expressions fit, of 49 nodes do not
    const heavy = (k: number) => def({ polygon: { n: '1024', x: `i${' + 0'.repeat(k)}`, y: `0${' + 0'.repeat(k)}` } });
    expect(problem(heavy(23))).toBe('ok');
    expect(problem(heavy(24))).toMatch(/^FLX_EXPR_BUDGET \/outline\/polygon\/[xy] the step budget is exhausted/);
    // the outline and its decorations share one budget, which the caller may pass
    // (every number spends a step, a literal too)
    const shared = { steps: 5 };
    const d = def({ path: 'M {w} 0' }, { decorations: [{ path: 'M {h} 0' }] });
    expect(problem(d, {}, shared)).toBe('ok');
    expect(shared.steps).toBe(1);
    expect(problem(d, {}, { steps: 2 })).toBe('FLX_EXPR_BUDGET /decorations/0/path the step budget is exhausted in "h"');
    expect(problem(d, {}, { steps: 4 })).toBe('ok');
    // the size is part of the scope, checked like any value
    expect(evaluateOutline(def({ path: 'M {w} 0' }), { w: Number.NaN, h: 1 }).ok).toBe(false);
  });
});
