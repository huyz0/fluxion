// FR-LAY-003: the built-in `tree` and `orgchart` layouts: a non-layered tidy tree of variable-size boxes, in four directions.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { orgchartLayout, type TreeOptions, treeLayout } from './tree.js';
import type { LayoutEdge, LayoutInput, LayoutNode } from './types.js';

type Placed = { x: number; y: number; w: number; h: number };
const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, w: number, h: number, order: number): LayoutNode => ({ id, box: { x: 0, y: 0, w, h }, order });
const edge = (id: string, source: string, target: string, order: number): LayoutEdge => ({ id, source, target, order });
const options = (raw: unknown, layout = treeLayout): TreeOptions => {
  const r = layout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const overlap = (a: Placed, b: Placed) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Whether `child` lies wholly past `parent` along `direction`. */
const past = (parent: Placed, child: Placed, direction: TreeOptions['direction']) =>
  direction === 'down'
    ? child.y >= parent.y + parent.h
    : direction === 'up'
      ? child.y + child.h <= parent.y
      : direction === 'right'
        ? child.x >= parent.x + parent.w
        : child.x + child.w <= parent.x;

/** A forest of `count` variable-size nodes: node i > 0 hangs under an earlier node, or starts a new tree. */
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

/**
 * Fixture tree-org-40: a CEO, 4 vice presidents of different sizes, 3 managers under each but the last, and 2 or 3 staff under each
 * manager; 40 nodes. The golden is the orgchart's top-left corners, `id x,y`.
 */
function orgFixture(): LayoutInput {
  const nodes: LayoutNode[] = [node('ceo', 180, 70, 0)];
  const edges: LayoutEdge[] = [];
  const add = (id: string, parent: string, w: number, h: number) => {
    nodes.push(node(id, w, h, nodes.length));
    edges.push(edge(`e-${id}`, parent, id, edges.length));
  };
  for (let v = 0; v < 4; v++) {
    add(`vp${v}`, 'ceo', 140 + v * 10, 60 + (v % 2) * 20);
    for (let m = 0; m < (v === 3 ? 1 : 3); m++) {
      add(`m${v}${m}`, `vp${v}`, 120, 50 + (m % 2) * 10);
      for (let s = 0; s < 2 + ((v + m) % 2) && nodes.length < 40; s++) add(`s${v}${m}${s}`, `m${v}${m}`, 100 + s * 10, 40);
    }
  }
  return { frame, nodes, edges };
}

describe('tree and orgchart layouts (FR-LAY-003)', () => {
  it('FR-LAY-003: golden tree-org-40, the orgchart of a 40-node organisation', () => {
    const input = orgFixture();
    expect(input.nodes).toHaveLength(40);
    const out = orgchartLayout.run(input, options(undefined, orgchartLayout)).boxes;
    const corners = input.nodes.map((n) => `${n.id} ${(out[n.id] as Placed).x},${(out[n.id] as Placed).y}`);
    expect(corners).toEqual(GOLDEN_TREE_ORG_40);
  });

  it('FR-LAY-003: for random forests of variable-size boxes, no two boxes overlap and every parent is before its children, in each direction', () => {
    fc.assert(
      fc.property(forest, fc.constantFrom('down', 'right', 'up', 'left'), fc.boolean(), (f, direction, compactLeaves) => {
        const input = forestInput(f);
        const out = treeLayout.run(input, options({ direction, compactLeaves })).boxes;
        const boxes = input.nodes.map((n) => out[n.id] as Placed);
        for (const [i, b] of boxes.entries()) {
          expect([b.w, b.h]).toEqual([input.nodes[i]?.box.w, input.nodes[i]?.box.h]);
          for (const o of boxes.slice(i + 1)) expect(overlap(b, o)).toBe(false);
        }
        for (const e of input.edges ?? []) expect(past(out[e.source] as Placed, out[e.target] as Placed, direction)).toBe(true);
      }),
    );
  });

  it('FR-LAY-003: a child hangs one rank gap below its own parent, not on a shared rank (non-layered)', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('r', 100, 40, 0), node('tall', 100, 200, 1), node('short', 100, 40, 2), node('a', 60, 30, 3), node('b', 60, 30, 4)],
      edges: [edge('e0', 'r', 'tall', 0), edge('e1', 'r', 'short', 1), edge('e2', 'tall', 'a', 2), edge('e3', 'short', 'b', 3)],
    };
    const out = treeLayout.run(input, options({ padding: 0, rankGap: 50 })).boxes as Record<string, Placed>;
    expect(out['tall']?.y).toBe(90);
    expect(out['a']?.y).toBe(90 + 200 + 50);
    expect(out['b']?.y).toBe(90 + 40 + 50);
  });

  it('FR-LAY-003: a parent is centred over its first and last child, siblings one node gap apart', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('p', 40, 40, 0), node('a', 100, 40, 1), node('b', 60, 40, 2)],
      edges: [edge('e0', 'p', 'a', 0), edge('e1', 'p', 'b', 1)],
    };
    const out = treeLayout.run(input, options({ padding: 0, nodeGap: 20 })).boxes as Record<string, Placed>;
    expect(out['a']?.x).toBe(0);
    expect(out['b']?.x).toBe(120);
    expect((out['p']?.x ?? 0) + 20).toBe((50 + 150) / 2);
  });

  it('FR-LAY-003: orgchart stacks the leaves of one parent in a column under it; tree spreads them', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('p', 100, 40, 0), node('a', 80, 30, 1), node('b', 80, 30, 2), node('c', 80, 30, 3)],
      edges: [edge('e0', 'p', 'a', 0), edge('e1', 'p', 'b', 1), edge('e2', 'p', 'c', 2)],
    };
    const org = orgchartLayout.run(input, options({ padding: 0 }, orgchartLayout)).boxes as Record<string, Placed>;
    expect(new Set(['a', 'b', 'c'].map((id) => org[id]?.x))).toEqual(new Set([10]));
    expect(['a', 'b', 'c'].map((id) => org[id]?.y)).toEqual([120, 170, 220]);
    const tree = treeLayout.run(input, options({ padding: 0 })).boxes as Record<string, Placed>;
    expect(new Set(['a', 'b', 'c'].map((id) => tree[id]?.y))).toEqual(new Set([120]));
  });

  it('FR-LAY-003: a second parent and a cycle are ignored, so a graph still lays out as a forest', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('a', 50, 50, 0), node('b', 50, 50, 1), node('c', 50, 50, 2)],
      edges: [edge('e0', 'a', 'b', 0), edge('e1', 'b', 'c', 1), edge('e2', 'c', 'a', 2), edge('e3', 'a', 'c', 3)],
    };
    const out = treeLayout.run(input, options({ padding: 0 })).boxes as Record<string, Placed>;
    expect([out['a']?.y, out['b']?.y, out['c']?.y]).toEqual([0, 130, 260]);
  });

  it('FR-LAY-008: the same forest in another order gives the same boxes; pinned nodes keep theirs; odd ids work', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('constructor', 80, 40, 0), { ...node('__proto__', 60, 30, 1), pinned: true, box: { x: 5, y: 6, w: 60, h: 30 } }, node('c', 70, 30, 2)],
      edges: [edge('e0', 'constructor', '__proto__', 0), edge('e1', 'constructor', 'c', 1)],
    };
    const o = options({});
    const first = treeLayout.run(input, o);
    expect(treeLayout.run({ ...input, nodes: [...input.nodes].reverse(), edges: [...(input.edges ?? [])].reverse() }, o)).toEqual(first);
    expect(Object.keys(first.boxes).sort()).toEqual(['__proto__', 'c', 'constructor']);
    expect(first.boxes['__proto__']).toEqual({ x: 5, y: 6, w: 60, h: 30 });
    expect(treeLayout.run({ frame, nodes: [] }, o)).toEqual({ boxes: {} });
  });

  it('FR-LAY-001: options are checked against the schema; orgchart turns compactLeaves on by default', () => {
    expect(treeLayout.parseOptions({ direction: 'sideways' })).toMatchObject({ ok: false });
    expect(treeLayout.parseOptions({ extra: 1 })).toMatchObject({ ok: false });
    expect(options(undefined).compactLeaves).toBe(false);
    expect(options(undefined, orgchartLayout).compactLeaves).toBe(true);
    expect(options({ direction: 'left', nodeGap: 4 })).toMatchObject({ direction: 'left', nodeGap: 4, padding: 80 });
  });
});

// regenerate only for a deliberate change to the algorithm, with the reason in the commit and a `version` bump
const GOLDEN_TREE_ORG_40: readonly string[] = [
  'ceo 850,80',
  'vp0 230,230',
  'm00 80,370',
  's000 90,500',
  's001 85,560',
  'm01 240,370',
  's010 250,510',
  's011 245,570',
  's012 240,630',
  'm02 400,370',
  's020 410,500',
  's021 405,560',
  'vp1 705,230',
  'm10 560,390',
  's100 570,520',
  's101 565,580',
  's102 560,640',
  'm11 720,390',
  's110 730,530',
  's111 725,590',
  'm12 880,390',
  's120 890,520',
  's121 885,580',
  's122 880,640',
  'vp2 1180,230',
  'm20 1040,370',
  's200 1050,500',
  's201 1045,560',
  'm21 1200,370',
  's210 1210,510',
  's211 1205,570',
  's212 1200,630',
  'm22 1360,370',
  's220 1370,500',
  's221 1365,560',
  'vp3 1495,230',
  'm30 1520,390',
  's300 1530,520',
  's301 1525,580',
  's302 1520,640',
];
