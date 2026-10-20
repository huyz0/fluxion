// FR-LAY-003: the built-in `mindmap` layout: the root in the middle and its subtrees on two balanced sides.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dealSides, type MindmapOptions, mindmapLayout } from './mindmap.js';
import type { LayoutEdge, LayoutInput, LayoutNode } from './types.js';

type Placed = { x: number; y: number; w: number; h: number };
const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, w: number, h: number, order: number): LayoutNode => ({ id, box: { x: 0, y: 0, w, h }, order });
const edge = (id: string, source: string, target: string, order: number): LayoutEdge => ({ id, source, target, order });
const options = (raw: unknown): MindmapOptions => {
  const r = mindmapLayout.parseOptions(raw);
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

/** The laid-out height of each of the root's subtrees (the root is `n0`). */
function subtreeExtents(input: LayoutInput, out: Readonly<Record<string, Placed>>): number[] {
  const children = new Map<string, string[]>();
  for (const e of input.edges ?? []) children.set(e.source, [...(children.get(e.source) ?? []), e.target]);
  const below = (id: string): string[] => [id, ...(children.get(id) ?? []).flatMap(below)];
  return (children.get('n0') ?? []).map((k) => {
    const bs = below(k).map((id) => out[id] as Placed);
    return Math.max(...bs.map((b) => b.y + b.h)) - Math.min(...bs.map((b) => b.y));
  });
}

/** A tree of `count` variable-size nodes: node i > 0 hangs under an earlier node. */
const tree = fc.integer({ min: 1, max: 40 }).chain((count) =>
  fc.record({
    sizes: fc.array(fc.tuple(fc.integer({ min: 1, max: 220 }), fc.integer({ min: 1, max: 140 })), { minLength: count, maxLength: count }),
    parents: fc.array(fc.nat(), { minLength: count, maxLength: count }),
  }),
);

function treeInput({ sizes, parents }: { sizes: Array<[number, number]>; parents: number[] }): LayoutInput {
  const nodes = sizes.map(([w, h], i) => node(`n${i}`, w, h, i));
  const edges = parents.flatMap((p, i) => (i === 0 ? [] : [edge(`e${i}`, `n${p % i}`, `n${i}`, i)]));
  return { frame, nodes, edges };
}

/** Fixture mindmap-25: a topic with 6 branches of 0 to 5 ideas, one idea with two details; 25 nodes. The golden is the top-left corners. */
function mindmapFixture(): LayoutInput {
  const nodes: LayoutNode[] = [node('topic', 200, 90, 0)];
  const edges: LayoutEdge[] = [];
  const add = (id: string, parent: string, w: number, h: number) => {
    nodes.push(node(id, w, h, nodes.length));
    edges.push(edge(`e-${id}`, parent, id, edges.length));
  };
  for (const [b, ideas] of [5, 1, 4, 0, 3, 3].entries()) {
    add(`b${b}`, 'topic', 120 + (b % 3) * 20, 50);
    for (let i = 0; i < ideas; i++) add(`b${b}i${i}`, `b${b}`, 90 + (i % 2) * 30, 34);
  }
  add('d0', 'b2i1', 80, 30);
  add('d1', 'b2i1', 80, 30);
  return { frame, nodes, edges };
}

describe('mindmap layout (FR-LAY-003)', () => {
  it('FR-LAY-003: golden mindmap-25, a topic with six branches', () => {
    const input = mindmapFixture();
    expect(input.nodes).toHaveLength(25);
    const out = mindmapLayout.run(input, options(undefined)).boxes;
    const corners = input.nodes.map((n) => `${n.id} ${(out[n.id] as Placed).x},${(out[n.id] as Placed).y}`);
    expect(corners).toEqual(GOLDEN_MINDMAP_25);
  });

  it('FR-LAY-003: for random trees, no two boxes overlap and each branch grows away from the root on its side', () => {
    fc.assert(
      fc.property(tree, fc.constantFrom('compact', 'comfortable', 'spacious'), (t, spacing) => {
        const input = treeInput(t);
        const out = mindmapLayout.run(input, options({ spacing })).boxes;
        expectSizesKeptAndNoOverlap(input, out as Record<string, Placed>);
        const boxes = input.nodes.map((n) => out[n.id] as Placed);
        const root = out['n0'] as Placed;
        for (const e of input.edges ?? []) {
          const [p, c] = [out[e.source] as Placed, out[e.target] as Placed];
          const right = c.x >= root.x + root.w;
          expect(right || c.x + c.w <= root.x).toBe(true);
          expect(right ? c.x >= p.x + p.w : c.x + c.w <= p.x).toBe(true);
        }
        // the sides' laid-out heights differ by at most the tallest subtree plus one node gap
        const height = (side: Placed[]) => (side.length ? Math.max(...side.map((b) => b.y + b.h)) - Math.min(...side.map((b) => b.y)) : 0);
        const others = boxes.slice(1);
        const subtreeHeights = subtreeExtents(input, out as Record<string, Placed>);
        const gap = { compact: 24, comfortable: 40, spacious: 64 }[spacing];
        const [r, l] = [others.filter((b) => b.x > root.x), others.filter((b) => b.x < root.x)];
        expect(Math.abs(height(r) - height(l))).toBeLessThanOrEqual(Math.max(0, ...subtreeHeights) + gap + 1e-9);
      }),
    );
  });

  it('FR-LAY-003: the two sides differ in height by at most the tallest subtree', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 900 }), { maxLength: 20 }), fc.integer({ min: 0, max: 60 }), (heights, gap) => {
        const { right, left } = dealSides(heights, gap);
        expect([...right, ...left].sort((a, b) => a - b)).toEqual(heights.map((_, i) => i));
        expect(right).toEqual([...right].sort((a, b) => a - b));
        const total = (side: number[]) => side.reduce((sum, i) => sum + (heights[i] as number) + gap, 0);
        expect(Math.abs(total(right) - total(left))).toBeLessThanOrEqual(Math.max(0, ...heights) + gap);
      }),
    );
  });

  it('FR-LAY-003: subtrees of one side do not nest, so shallow tall roots and thin deep ones balance as dealt (review M17.4 F1)', () => {
    // X: a 1x1 root over a 1x100 child; Y: a 1x100 leaf; Z: a 300x100 leaf; all 100 tall, in the order X Z Y Z X Z Y Z ...
    const nodes: LayoutNode[] = [node('r', 10, 10, 0)];
    const edges: LayoutEdge[] = [];
    const add = (id: string, parent: string, w: number, h: number) => {
      nodes.push(node(id, w, h, nodes.length));
      edges.push(edge(`e-${id}`, parent, id, edges.length));
    };
    const SHAPES = { X: [1, 1], Y: [1, 100], Z: [300, 100] } as const;
    for (const [i, kind] of [...'XZYZ'.repeat(4)].entries()) {
      const [w, h] = SHAPES[kind as keyof typeof SHAPES];
      add(`${kind}${i}`, 'r', w, h);
      if (kind === 'X') add(`${kind}${i}c`, `${kind}${i}`, 1, 100);
    }
    const out = mindmapLayout.run({ frame, nodes, edges }, options({ padding: 0 })).boxes as Record<string, Placed>;
    const root = out['r'] as Placed;
    const height = (bs: Placed[]) => Math.max(...bs.map((b) => b.y + b.h)) - Math.min(...bs.map((b) => b.y));
    const others = nodes.slice(1).map((n) => out[n.id] as Placed);
    expect(Math.abs(height(others.filter((b) => b.x > root.x)) - height(others.filter((b) => b.x < root.x)))).toBeLessThanOrEqual(100 + 40);
  });

  it('FR-LAY-003: each side is centred on the root; a single branch goes right', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('r', 100, 40, 0), node('a', 60, 100, 1), node('b', 60, 20, 2)],
      edges: [edge('e0', 'r', 'a', 0), edge('e1', 'r', 'b', 1)],
    };
    const out = mindmapLayout.run(input, options({ padding: 0, rankGap: 30 })).boxes as Record<string, Placed>;
    const mid = (b: Placed | undefined) => (b?.y ?? 0) + (b?.h ?? 0) / 2;
    expect(out['a']?.x).toBe(60 + 30 + 100 + 30);
    expect(out['b']?.x).toBe(0);
    expect([mid(out['a']), mid(out['b'])]).toEqual([mid(out['r']), mid(out['r'])]);
    const one = mindmapLayout.run({ frame, nodes: input.nodes.slice(0, 2), edges: (input.edges ?? []).slice(0, 1) }, options({ padding: 0 })).boxes;
    expect((one['a'] as Placed).x).toBeGreaterThan((one['r'] as Placed).x);
  });

  it('FR-LAY-008: the same tree in another order gives the same boxes; pinned nodes keep theirs; odd ids work', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('constructor', 80, 40, 0), { ...node('__proto__', 60, 30, 1), pinned: true, box: { x: 5, y: 6, w: 60, h: 30 } }, node('c', 70, 30, 2)],
      edges: [edge('e0', 'constructor', '__proto__', 0), edge('e1', 'constructor', 'c', 1)],
    };
    const o = options({});
    const first = mindmapLayout.run(input, o);
    expect(mindmapLayout.run({ ...input, nodes: [...input.nodes].reverse(), edges: [...(input.edges ?? [])].reverse() }, o)).toEqual(first);
    expect(Object.keys(first.boxes).sort()).toEqual(['__proto__', 'c', 'constructor']);
    expect(first.boxes['__proto__']).toEqual({ x: 5, y: 6, w: 60, h: 30 });
    expect(mindmapLayout.run({ frame, nodes: [] }, o)).toEqual({ boxes: {} });
  });

  it('FR-LAY-001: options are checked against the schema', () => {
    expect(mindmapLayout.parseOptions({ spacing: 'roomy' })).toMatchObject({ ok: false });
    expect(mindmapLayout.parseOptions({ direction: 'down' })).toMatchObject({ ok: false });
    expect(options(undefined)).toEqual({ spacing: 'comfortable', padding: 80 });
  });
});

// regenerate only for a deliberate change to the algorithm, with the reason in the commit and a `version` bump
const GOLDEN_MINDMAP_25: readonly string[] = [
  'topic 680,356',
  'b0 960,220',
  'b0i0 1160,80',
  'b0i1 1160,154',
  'b0i2 1160,228',
  'b0i3 1160,302',
  'b0i4 1160,376',
  'b1 460,117',
  'b1i0 290,125',
  'b2 440,310',
  'b2i0 270,207',
  'b2i1 240,281',
  'b2i2 270,355',
  'b2i3 240,429',
  'b3 960,450',
  'b4 460,569',
  'b4i0 290,503',
  'b4i1 260,577',
  'b4i2 290,651',
  'b5 960,606',
  'b5i0 1200,540',
  'b5i1 1200,614',
  'b5i2 1200,688',
  'd0 80,248',
  'd1 80,318',
];
