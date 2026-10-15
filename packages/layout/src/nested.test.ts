// FR-LAY-005: nested containers are laid out bottom-up; a container nothing pins is sized to its children and moves them with it, and a pinned one
// (or one with a pinned node below it) keeps its box.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyPins, gridLayout, layoutNested, type NestedRunner, removeOverlap, snapBoxes, stackLayout } from './index.js';
import type { Boxes } from './passes.js';
import type { LayoutAlgorithm, LayoutInput, LayoutNode } from './types.js';

type Placed = { x: number; y: number; w: number; h: number };
const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const box = (x: number, y: number, w: number, h: number): Placed => ({ x, y, w, h });

/** A node of a test tree: size, an optional pin, children. */
type Spec = { id: string; w: number; h: number; pin?: { x: number; y: number }; kids?: Spec[] };

/** The flat nodes of a tree of specs, in depth-first order (order = position in that walk). */
function flatten(roots: readonly Spec[]): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  const walk = (spec: Spec, parentId?: string) => {
    nodes.push({
      id: spec.id,
      box: { x: spec.pin?.x ?? 0, y: spec.pin?.y ?? 0, w: spec.w, h: spec.h },
      order: nodes.length,
      ...(spec.pin ? { pinned: true } : {}),
      ...(parentId ? { parentId } : {}),
    });
    for (const k of spec.kids ?? []) walk(k, spec.id);
  };
  for (const r of roots) walk(r);
  return nodes;
}

/** A runner: one algorithm and options for every level, then the pins, overlap and snap passes. */
function runnerOf(algorithm: LayoutAlgorithm<never>, raw: unknown): NestedRunner {
  const options = algorithm.parseOptions(raw);
  if (!options.ok) throw new Error(options.message);
  return (_container, input) => snapBoxes(input, removeOverlap(input, applyPins(input, algorithm.run(input, options.value as never).boxes)));
}
const stack = runnerOf(stackLayout as never, { padding: 0, gap: 10 });

const nested = (roots: Spec[], run: NestedRunner = stack): Boxes => layoutNested({ frame, nodes: flatten(roots) }, run, {});
const at = (out: Boxes, id: string): Placed => out[id] as Placed;
const inside = (inner: Placed, outer: Placed, inset: number) =>
  inner.x >= outer.x + inset - 1e-6 &&
  inner.y >= outer.y + inset - 1e-6 &&
  inner.x + inner.w <= outer.x + outer.w - inset + 1e-6 &&
  inner.y + inner.h <= outer.y + outer.h - inset + 1e-6;

describe('nested containers (FR-LAY-005)', () => {
  it('FR-LAY-005: fixture nested-containers sizes a container to its children plus the inset and puts them inside it', () => {
    const out = nested([
      {
        id: 'a',
        w: 1,
        h: 1,
        kids: [
          { id: 'a1', w: 100, h: 50 },
          { id: 'a2', w: 80, h: 40 },
        ],
      },
      { id: 'free', w: 60, h: 30 },
    ]);
    // a's children stack down with gap 10: 100 x 100 together, so a is 132 x 132 and its children sit 16 px in
    expect(at(out, 'a')).toEqual(box(0, 0, 132, 132));
    expect(at(out, 'a1')).toEqual(box(16, 16, 100, 50));
    expect(at(out, 'a2')).toEqual(box(16, 76, 80, 40));
    expect(at(out, 'free')).toEqual(box(0, 142, 60, 30));
  });

  it('FR-LAY-005: containers inside containers are laid out deepest first and move with their parent', () => {
    const tree: Spec[] = [
      { id: 'free', w: 40, h: 40 },
      {
        id: 'outer',
        w: 1,
        h: 1,
        kids: [
          { id: 'o1', w: 50, h: 20 },
          {
            id: 'inner',
            w: 1,
            h: 1,
            kids: [
              { id: 'i1', w: 30, h: 30 },
              { id: 'i2', w: 30, h: 30 },
            ],
          },
        ],
      },
    ];
    const out = nested(tree);
    // inner: i1 and i2 stacked with gap 10 are 30 x 70, so inner is 62 x 102; outer holds o1 (50 x 20) and inner, 62 wide
    expect(at(out, 'inner').w).toBe(62);
    expect(at(out, 'inner').h).toBe(102);
    expect(at(out, 'outer').w).toBe(62 + 32);
    for (const [child, parent] of [
      ['o1', 'outer'],
      ['inner', 'outer'],
      ['i1', 'inner'],
      ['i2', 'inner'],
    ] as const)
      expect(inside(at(out, child), at(out, parent), 16)).toBe(true);
    expect(at(out, 'outer').y).toBeGreaterThanOrEqual(at(out, 'free').y + 40);
  });

  it('FR-LAY-005: a pinned container keeps its box and lays its children out inside it; one with a pinned node below it keeps its box too', () => {
    const out = nested([
      { id: 'pinned', w: 300, h: 200, pin: { x: 500, y: 300 }, kids: [{ id: 'c1', w: 50, h: 50 }] },
      {
        id: 'holder',
        w: 400,
        h: 300,
        kids: [
          { id: 'fixed', w: 60, h: 60, pin: { x: 900, y: 100 } },
          { id: 'loose', w: 70, h: 40 },
        ],
      },
    ]);
    expect(at(out, 'pinned')).toEqual(box(500, 300, 300, 200));
    expect(inside(at(out, 'c1'), at(out, 'pinned'), 0)).toBe(true);
    // holder is anchored by the pinned node below it: it keeps the box it had (0, 0), the pinned node keeps its place
    expect(at(out, 'holder')).toEqual(box(0, 0, 400, 300));
    expect(at(out, 'fixed')).toEqual(box(900, 100, 60, 60));
    expect(inside(at(out, 'loose'), at(out, 'holder'), 0)).toBe(true);
  });

  it('FR-LAY-005: a parent that is missing, its own or in a cycle makes the node a root, and every node still gets a box', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', box: box(0, 0, 50, 50), order: 0, parentId: 'b' },
      { id: 'b', box: box(0, 0, 50, 50), order: 1, parentId: 'a' },
      { id: 'self', box: box(0, 0, 50, 50), order: 2, parentId: 'self' },
      { id: 'lost', box: box(0, 0, 50, 50), order: 3, parentId: 'nowhere' },
    ];
    const out = layoutNested({ frame, nodes }, stack, {});
    expect(Object.keys(out).sort()).toEqual(['a', 'b', 'lost', 'self']);
  });

  it('FR-LAY-005: the runner gets the container id, the edges between siblings, and a container frame of its own', () => {
    const calls: Array<{ container: string | undefined; ids: string[]; edges: number }> = [];
    const spy: NestedRunner = (container, input) => {
      calls.push({ container, ids: input.nodes.map((n) => n.id), edges: input.edges?.length ?? 0 });
      return stack(container, input);
    };
    const nodes = flatten([
      {
        id: 'g',
        w: 1,
        h: 1,
        kids: [
          { id: 'g1', w: 10, h: 10 },
          { id: 'g2', w: 10, h: 10 },
        ],
      },
      { id: 'x', w: 10, h: 10 },
    ]);
    const edges = [
      { id: 'in', source: 'g1', target: 'g2', order: 0 },
      { id: 'across', source: 'g1', target: 'x', order: 1 },
    ];
    layoutNested({ frame, nodes, edges }, spy, {});
    expect(calls).toEqual([
      { container: 'g', ids: ['g1', 'g2'], edges: 1 },
      { container: undefined, ids: ['g', 'x'], edges: 0 },
    ]);
  });

  it('FR-LAY-005: for random trees of depth up to 3 every unpinned container holds its children, siblings stay clear, pinned boxes are exact and the result is deterministic', () => {
    const leaf = fc.record({ w: fc.integer({ min: 5, max: 120 }), h: fc.integer({ min: 5, max: 80 }) });
    const pin = fc.option(fc.record({ x: fc.integer({ min: 0, max: 800 }), y: fc.integer({ min: 0, max: 600 }) }), { nil: undefined, freq: 5 });
    const tree = (depth: number): fc.Arbitrary<Spec> =>
      depth === 0
        ? fc.tuple(leaf, pin).map(([s, p]) => ({ id: '', ...s, ...(p ? { pin: p } : {}) }))
        : fc
            .tuple(leaf, pin, fc.array(tree(depth - 1), { minLength: 1, maxLength: 3 }))
            .map(([s, p, kids]) => ({ id: '', ...s, ...(p ? { pin: p } : {}), kids }));
    const forest = fc.array(tree(3), { minLength: 1, maxLength: 3 });
    const name = (specs: Spec[], prefix = 'n'): Spec[] =>
      specs.map((s, i) => ({ ...s, id: `${prefix}${i}`, ...(s.kids ? { kids: name(s.kids, `${prefix}${i}.`) } : {}) }));
    const runners = [runnerOf(stackLayout as never, { padding: 0, gap: 8 }), runnerOf(gridLayout as never, { padding: 0, gap: 8, columns: 2 })];
    fc.assert(
      fc.property(forest, fc.integer({ min: 0, max: 1 }), (specs, which) => {
        const roots = name(specs);
        const nodes = flatten(roots);
        const run = runners[which] as NestedRunner;
        const out = layoutNested({ frame, nodes }, run, {});
        expect(layoutNested({ frame, nodes }, run, {})).toEqual(out);
        expectLaidOut(nodes, out);
      }),
      { numRuns: 120, seed: 20261015 },
    );
  });
});

/** The ids that are pinned or have a pinned node below them: anchored containers keep their box. */
function anchoredIds(nodes: readonly LayoutNode[]): Set<string> {
  const anchored = new Set<string>();
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId] as const));
  for (const n of nodes) if (n.pinned) for (let id: string | undefined = n.id; id !== undefined; id = parentOf.get(id)) anchored.add(id);
  return anchored;
}

const clearance = (b: Placed, c: Placed) => Math.max(Math.max(b.x, c.x) - Math.min(b.x + b.w, c.x + c.w), Math.max(b.y, c.y) - Math.min(b.y + b.h, c.y + c.h));

/** Every node has a box, pinned ones are exact, unanchored containers hold their children, and unpinned siblings are clear of each other. */
function expectLaidOut(nodes: readonly LayoutNode[], out: Boxes): void {
  const anchored = anchoredIds(nodes);
  for (const n of nodes) {
    const b = at(out, n.id);
    if (n.pinned) expect(b).toEqual(n.box);
    if (n.parentId && !anchored.has(n.parentId)) expect(inside(b, at(out, n.parentId), 16)).toBe(true);
    for (const o of nodes.filter((m) => m !== n && m.parentId === n.parentId && !(anchored.has(n.id) && anchored.has(m.id)))) {
      expect(clearance(b, at(out, o.id))).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
  }
}
