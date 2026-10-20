// FR-LAY-003: the built-in `radial` layout: the tree on rings around its root, arcs shared by leaf count.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type RadialOptions, radialLayout } from './radial.js';
import type { LayoutEdge, LayoutInput, LayoutNode } from './types.js';

type Placed = { x: number; y: number; w: number; h: number };
const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, w: number, h: number, order: number): LayoutNode => ({ id, box: { x: 0, y: 0, w, h }, order });
const edge = (id: string, source: string, target: string, order: number): LayoutEdge => ({ id, source, target, order });
const options = (raw: unknown): RadialOptions => {
  const r = radialLayout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const overlap = (a: Placed, b: Placed) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every box keeps its node's size and no two overlap. */
function expectSizesKeptAndNoOverlap(input: LayoutInput, out: Readonly<Record<string, Placed>>) {
  const boxes = input.nodes.map((n) => out[n.id] as Placed);
  for (const [i, b] of boxes.entries()) {
    expect([b.w, b.h]).toEqual([input.nodes[i]?.box.w, input.nodes[i]?.box.h]);
    for (const o of boxes.slice(i + 1)) expect(overlap(b, o)).toBe(false);
  }
}
const middle = (b: Placed) => [b.x + b.w / 2, b.y + b.h / 2] as const;

const forest = fc.integer({ min: 1, max: 40 }).chain((count) =>
  fc.record({
    sizes: fc.array(fc.tuple(fc.integer({ min: 1, max: 220 }), fc.integer({ min: 1, max: 140 })), { minLength: count, maxLength: count }),
    parents: fc.array(fc.option(fc.nat(), { nil: undefined }), { minLength: count, maxLength: count }),
  }),
);

function forestInput({ sizes, parents }: { sizes: Array<[number, number]>; parents: Array<number | undefined> }): LayoutInput {
  const nodes = sizes.map(([w, h], i) => node(`n${i}`, w, h, i));
  const edges = parents.flatMap((p, i) => (i === 0 || p === undefined ? [] : [edge(`e${i}`, `n${p % i}`, `n${i}`, i)]));
  return { frame, nodes, edges };
}

/** Fixture radial-30: a hub, 5 spokes of different sizes, 2 to 6 leaves under each spoke and one grandchild; 30 nodes. The golden is the top-left corners. */
function radialFixture(): LayoutInput {
  const nodes: LayoutNode[] = [node('hub', 160, 80, 0)];
  const edges: LayoutEdge[] = [];
  const add = (id: string, parent: string, w: number, h: number) => {
    nodes.push(node(id, w, h, nodes.length));
    edges.push(edge(`e-${id}`, parent, id, edges.length));
  };
  for (const [k, leaves] of [6, 3, 6, 2, 6].entries()) {
    add(`k${k}`, 'hub', 110 + k * 10, 50 + (k % 2) * 10);
    for (let l = 0; l < leaves; l++) add(`k${k}l${l}`, `k${k}`, 70 + (l % 3) * 10, 36);
  }
  nodes.push(node('lone', 90, 40, nodes.length));
  return { frame, nodes, edges: [...edges, edge('e-lone', 'k3', 'lone', edges.length)] };
}

describe('radial layout (FR-LAY-003)', () => {
  it('FR-LAY-003: golden radial-30, a hub with five spokes and their leaves', () => {
    const input = radialFixture();
    expect(input.nodes).toHaveLength(30);
    const out = radialLayout.run(input, options(undefined)).boxes;
    const corners = input.nodes.map((n) => `${n.id} ${(out[n.id] as Placed).x.toFixed(1)},${(out[n.id] as Placed).y.toFixed(1)}`);
    expect(corners).toEqual(GOLDEN_RADIAL_30);
  });

  it('FR-LAY-003: for random forests, no two boxes overlap and every child is farther from the centre than its parent', () => {
    fc.assert(
      fc.property(forest, fc.constantFrom('compact', 'comfortable', 'spacious'), (f, spacing) => {
        const input = forestInput(f);
        const out = radialLayout.run(input, options({ spacing })).boxes;
        expectSizesKeptAndNoOverlap(input, out as Record<string, Placed>);
        const [cx, cy] = middle(out['n0'] as Placed);
        const away = (id: string) => Math.hypot(middle(out[id] as Placed)[0] - cx, middle(out[id] as Placed)[1] - cy);
        if (input.edges?.length && input.nodes.length === new Set([...input.edges.map((e) => e.target), 'n0']).size)
          for (const e of input.edges) expect(away(e.target)).toBeGreaterThan(away(e.source));
      }),
    );
  });

  it('FR-LAY-003: a child sits in the middle of its share of the arc, shares in proportion to leaves; the first starts at the top', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('r', 40, 40, 0), node('a', 20, 20, 1), node('b', 20, 20, 2), node('b1', 20, 20, 3), node('b2', 20, 20, 4), node('b3', 20, 20, 5)],
      edges: [edge('e0', 'r', 'a', 0), edge('e1', 'r', 'b', 1), edge('e2', 'b', 'b1', 2), edge('e3', 'b', 'b2', 3), edge('e4', 'b', 'b3', 4)],
    };
    const out = radialLayout.run(input, options({ padding: 0 })).boxes as Record<string, Placed>;
    const [cx, cy] = middle(out['r'] as Placed);
    const turn = (id: string) => {
      const [x, y] = middle(out[id] as Placed);
      return (Math.atan2(y - cy, x - cx) + (5 * Math.PI) / 2) % (2 * Math.PI);
    };
    // a has 1 leaf of 4: the arc [0, 1/4) of the turn from the top; b the rest; b's leaves a quarter each
    expect(turn('a')).toBeCloseTo(Math.PI / 4, 9);
    expect(turn('b')).toBeCloseTo(Math.PI / 2 + (3 * Math.PI) / 4, 9);
    expect([turn('b1'), turn('b2'), turn('b3')].map((t) => t / (Math.PI / 2))).toEqual([
      expect.closeTo(1.5, 9),
      expect.closeTo(2.5, 9),
      expect.closeTo(3.5, 9),
    ]);
  });

  it('FR-LAY-008: the same forest in another order gives the same boxes; pinned nodes keep theirs; odd ids work', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('constructor', 80, 40, 0), { ...node('__proto__', 60, 30, 1), pinned: true, box: { x: 5, y: 6, w: 60, h: 30 } }, node('c', 70, 30, 2)],
      edges: [edge('e0', 'constructor', '__proto__', 0), edge('e1', 'constructor', 'c', 1)],
    };
    const o = options({});
    const first = radialLayout.run(input, o);
    expect(radialLayout.run({ ...input, nodes: [...input.nodes].reverse(), edges: [...(input.edges ?? [])].reverse() }, o)).toEqual(first);
    expect(Object.keys(first.boxes).sort()).toEqual(['__proto__', 'c', 'constructor']);
    expect(first.boxes['__proto__']).toEqual({ x: 5, y: 6, w: 60, h: 30 });
    expect(radialLayout.run({ frame, nodes: [] }, o)).toEqual({ boxes: {} });
  });

  it('FR-LAY-001: options are checked against the schema', () => {
    expect(radialLayout.parseOptions({ spacing: 'roomy' })).toMatchObject({ ok: false });
    expect(radialLayout.parseOptions({ direction: 'down' })).toMatchObject({ ok: false });
    expect(options(undefined)).toEqual({ spacing: 'comfortable', padding: 80 });
  });
});

// regenerate only for a deliberate change to the algorithm, with the reason in the commit and a `version` bump
const GOLDEN_RADIAL_30: readonly string[] = [
  'hub 550.5,563.5',
  'k0 751.2,402.8',
  'k0l0 662.1,80.0',
  'k0l1 785.7,114.5',
  'k0l2 895.9,181.0',
  'k0l3 1000.0,275.1',
  'k0l4 1061.6,390.4',
  'k0l5 1091.1,519.0',
  'k1 800.1,668.6',
  'k1l0 1101.1,652.1',
  'k1l1 1061.6,780.7',
  'k1l2 990.0,895.9',
  'k2 565.5,827.0',
  'k2l0 905.9,990.0',
  'k2l1 785.7,1056.6',
  'k2l2 652.1,1091.1',
  'k2l3 529.0,1091.1',
  'k2l4 395.4,1056.6',
  'k2l5 275.1,990.0',
  'k3 330.9,668.6',
  'k3l0 191.0,895.9',
  'k3l1 119.5,780.7',
  'k4 379.8,402.8',
  'k4l0 90.0,519.0',
  'k4l1 119.5,390.4',
  'k4l2 181.0,275.1',
  'k4l3 285.1,181.0',
  'k4l4 395.4,114.5',
  'k4l5 519.0,80.0',
  'lone 80.0,650.1',
];
