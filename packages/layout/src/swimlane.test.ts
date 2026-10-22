// FR-LAY-003: the built-in `swimlane` layout: a layered flow inside each lane, the lanes stacked as bands.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type SwimlaneOptions, swimlaneLayout } from './swimlane.js';
import type { LayoutEdge, LayoutInput, LayoutNode } from './types.js';

type Placed = { x: number; y: number; w: number; h: number };
const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const step = (id: string, [w, h]: readonly [number, number], order: number, lane?: string): LayoutNode => ({
  id,
  box: { x: 0, y: 0, w, h },
  order,
  ...(lane === undefined ? {} : { hints: { lane } }),
});
const edge = (id: string, source: string, target: string, order: number): LayoutEdge => ({ id, source, target, order });
const options = (raw: unknown): SwimlaneOptions => {
  const r = swimlaneLayout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const overlap = (a: Placed, b: Placed) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Fixture swimlane-3x4: three lanes of four steps, a chain in each and a hand-over from every lane to the next. */
function laneFixture(): LayoutInput {
  const lanes = ['sales', 'ops', 'finance'];
  const nodes = lanes.flatMap((lane, l) =>
    Array.from({ length: 4 }, (_, i) => step(`${lane}${i}`, [110 + ((l + i) % 3) * 20, 46 + ((l * 4 + i) % 2) * 14], l * 4 + i, lane)),
  );
  const edges: LayoutEdge[] = [];
  for (const lane of lanes) for (let i = 0; i < 3; i++) edges.push(edge(`${lane}-${i}`, `${lane}${i}`, `${lane}${i + 1}`, edges.length));
  edges.push(edge('h0', 'sales3', 'ops0', edges.length), edge('h1', 'ops3', 'finance0', edges.length));
  return { frame, nodes, edges };
}

/** The extent of `boxes` across the lanes: y when lanes are rows, x when they are columns. */
const bandOf = (boxes: readonly Placed[], rows: boolean) =>
  rows
    ? ([Math.min(...boxes.map((b) => b.y)), Math.max(...boxes.map((b) => b.y + b.h))] as const)
    : ([Math.min(...boxes.map((b) => b.x)), Math.max(...boxes.map((b) => b.x + b.w))] as const);

/** Every edge (the graphs here have no cycles) ends further along the ranks than it starts, across lanes too (review M17.7 F1). */
function expectEdgesForward(edges: readonly LayoutEdge[], out: Readonly<Record<string, Placed>>, rows: boolean) {
  for (const e of edges) {
    const [s, t] = [out[e.source] as Placed, out[e.target] as Placed];
    expect(rows ? t.x >= s.x + s.w : t.y >= s.y + s.h, e.id).toBe(true);
  }
}

/** Each band starts at or after the end of the one before. */
function expectBandsInOrder(bands: ReadonlyArray<readonly [number, number]>) {
  for (const [i, band] of bands.entries()) if (i > 0) expect(band[0]).toBeGreaterThanOrEqual((bands[i - 1] as readonly [number, number])[1]);
}

/** Random steps: size, lane and the earlier step each hangs under. */
const steps = fc.array(fc.tuple(fc.integer({ min: 1, max: 220 }), fc.integer({ min: 1, max: 140 }), fc.constantFrom('a', 'b', 'c'), fc.nat()), {
  minLength: 1,
  maxLength: 24,
});

describe('swimlane layout (FR-LAY-003)', () => {
  it('FR-LAY-003: golden swimlane-3x4, three lanes of four steps', () => {
    const input = laneFixture();
    const out = swimlaneLayout.run(input, options(undefined)).boxes as Record<string, Placed>;
    const corners = input.nodes.map((n) => `${n.id} ${(out[n.id] as Placed).x},${(out[n.id] as Placed).y}`);
    expect(corners).toEqual(GOLDEN_SWIMLANE_3X4);
    expectEdgesForward(input.edges ?? [], out, true);
  });

  it('FR-LAY-003: WHEN nodes carry a lane each stays inside its lane band: bands are disjoint and in first-seen order (property)', () => {
    fc.assert(
      fc.property(steps, fc.constantFrom('right', 'down'), (list, direction) => {
        const nodes = list.map(([w, h, lane], i) => step(`n${i}`, [w, h], i, lane));
        const edges = list.flatMap(([, , , to], i) => (i === 0 ? [] : [edge(`e${i}`, `n${to % i}`, `n${i}`, i)]));
        const out = swimlaneLayout.run({ frame, nodes, edges }, options({ direction })).boxes as Record<string, Placed>;
        const placed = nodes.map((n) => out[n.id] as Placed);
        for (const [i, b] of placed.entries()) for (const o of placed.slice(i + 1)) expect(overlap(b, o)).toBe(false);
        expectEdgesForward(edges, out, direction === 'right');
        const lanes = [...new Set(list.map(([, , lane]) => lane))];
        expectBandsInOrder(
          lanes.map((lane) =>
            bandOf(
              placed.filter((_, i) => nodes[i]?.hints?.['lane'] === lane),
              direction === 'right',
            ),
          ),
        );
      }),
    );
  });

  it('FR-LAY-003: ranks run along the lanes inside a lane: a chain steps right (or down)', () => {
    const input: LayoutInput = { frame, nodes: [step('a', [50, 30], 0, 'x'), step('b', [50, 30], 1, 'x')], edges: [edge('e', 'a', 'b', 0)] };
    const right = swimlaneLayout.run(input, options({})).boxes as Record<string, Placed>;
    expect((right['b'] as Placed).x).toBeGreaterThan((right['a'] as Placed).x + 50);
    const down = swimlaneLayout.run(input, options({ direction: 'down' })).boxes as Record<string, Placed>;
    expect((down['b'] as Placed).y).toBeGreaterThan((down['a'] as Placed).y + 30);
  });

  it('FR-LAY-008: the same flow in another order gives the same boxes; pinned nodes keep theirs; odd ids work', () => {
    const input: LayoutInput = {
      frame,
      nodes: [
        step('constructor', [80, 40], 0, 'x'),
        { ...step('__proto__', [60, 30], 1, 'x'), pinned: true, box: { x: 5, y: 6, w: 60, h: 30 } },
        step('c', [70, 30], 2, 'y'),
      ],
      edges: [edge('e0', 'constructor', 'c', 0)],
    };
    const o = options({});
    const first = swimlaneLayout.run(input, o);
    expect(swimlaneLayout.run({ ...input, nodes: [...input.nodes].reverse() }, o)).toEqual(first);
    expect(Object.keys(first.boxes).sort()).toEqual(['__proto__', 'c', 'constructor']);
    expect(first.boxes['__proto__']).toEqual({ x: 5, y: 6, w: 60, h: 30 });
    expect(swimlaneLayout.run({ frame, nodes: [] }, o)).toEqual({ boxes: {} });
  });

  it('FR-LAY-001: options are checked against the schema', () => {
    expect(swimlaneLayout.parseOptions({ direction: 'up' })).toMatchObject({ ok: false });
    expect(swimlaneLayout.parseOptions({ padding: -1 })).toMatchObject({ ok: false });
    expect(options(undefined)).toEqual({ direction: 'right', spacing: 'comfortable', padding: 80 });
  });
});

// regenerate only for a deliberate change to the algorithm, with the reason in the commit and a `version` bump
const GOLDEN_SWIMLANE_3X4: readonly string[] = [
  'sales0 80,87',
  'sales1 270,80',
  'sales2 480,87',
  'sales3 710,80',
  'ops0 900,227',
  'ops1 1110,220',
  'ops2 1340,227',
  'ops3 1530,220',
  'finance0 1740,367',
  'finance1 1970,360',
  'finance2 2160,367',
  'finance3 2370,360',
];
