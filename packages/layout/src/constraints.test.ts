// FR-LAY-006: the constraints post-pass keeps pinned boxes where they are and aligned boxes on one coordinate, then orders and spaces what
// may move; the overlap pass after it never undoes an alignment.
import type { Box } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyConstraints } from './constraints.js';
import { layoutSync } from './pipeline.js';
import { stackLayout } from './stack.js';
import type { LayoutAlgorithm, LayoutConstraint, LayoutInput, LayoutNode } from './types.js';

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, order: number, box: Box, pinned = false): LayoutNode => ({ id, box, order, ...(pinned ? { pinned: true } : {}) });
const box = (x: number, y: number, w = 100, h = 50): Box => ({ x, y, w, h });
const input = (nodes: readonly LayoutNode[], constraints: readonly LayoutConstraint[]): LayoutInput => ({ frame, nodes, constraints });
const boxesOf = (nodes: readonly LayoutNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n.box]));

/** An algorithm that leaves every box where the input put it, so the post-passes alone decide the result. */
const asGiven: LayoutAlgorithm<Record<string, never>> = {
  id: 'test:as-given',
  version: '1',
  schema: stackLayout.schema as never,
  capabilities: { pins: true, compound: false, runsIn: 'main' },
  parseOptions: () => ({ ok: true, value: {} }),
  run: (inp) => ({ boxes: boxesOf(inp.nodes) }),
};

/** The point of `b` an `align` constraint lines up on `axis`. */
const pointOf = (b: Box, axis: 'x' | 'y', at: 'start' | 'center' | 'end'): number => {
  const [start, size] = axis === 'x' ? [b.x, b.w] : [b.y, b.h];
  return start + (at === 'start' ? 0 : at === 'center' ? size / 2 : size);
};

describe('constraints post-pass (FR-LAY-006)', () => {
  it('FR-LAY-006: an align group moves onto the lower median of its members, sizes kept', () => {
    const nodes = [node('a', 0, box(0, 0)), node('b', 1, box(200, 40, 60, 20)), node('c', 2, box(400, 90))];
    const out = applyConstraints(input(nodes, [{ type: 'align', axis: 'y', nodes: ['a', 'b', 'c'], at: 'start' }]), boxesOf(nodes));
    expect(out).toEqual({ a: box(0, 40), b: box(200, 40, 60, 20), c: box(400, 40) });
  });

  it('FR-LAY-006: a pinned member is the anchor of its group, and a pinned box never moves', () => {
    const nodes = [node('a', 0, box(0, 0)), node('p', 1, box(300, 500), true), node('c', 2, box(600, 10))];
    const out = applyConstraints(input(nodes, [{ type: 'sameRank', nodes: ['a', 'p', 'c'] }]), boxesOf(nodes));
    expect(out).toEqual({ a: box(0, 500), p: box(300, 500), c: box(600, 500) });
  });

  it('FR-LAY-006: order pushes the later box past the earlier one by the gap, and moves the earlier one when the later is fixed', () => {
    const nodes = [node('a', 0, box(100, 0)), node('b', 1, box(50, 0)), node('p', 2, box(0, 200), true)];
    const constraints: LayoutConstraint[] = [
      { type: 'order', axis: 'x', before: 'a', after: 'b', gap: 20 },
      { type: 'order', axis: 'y', before: 'a', after: 'p', gap: 10 },
    ];
    const out = applyConstraints(input(nodes, constraints), boxesOf(nodes));
    expect(out['b']).toEqual(box(220, 0));
    expect(out['a']).toEqual(box(100, 0));
    const late = [node('a', 0, box(0, 300)), node('p', 1, box(0, 200), true)];
    expect(applyConstraints(input(late, [{ type: 'order', axis: 'y', before: 'a', after: 'p', gap: 10 }]), boxesOf(late))['a']).toEqual(box(0, 140));
  });

  it('FR-LAY-006: an order chain listed backwards is still met', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id, i) => node(id, i, box(0, 0)));
    const chain: LayoutConstraint[] = [
      { type: 'order', axis: 'x', before: 'c', after: 'd' },
      { type: 'order', axis: 'x', before: 'b', after: 'c' },
      { type: 'order', axis: 'x', before: 'a', after: 'b' },
    ];
    const out = applyConstraints(input(nodes, chain), boxesOf(nodes));
    expect(['a', 'b', 'c', 'd'].map((id) => (out[id] as Box).x)).toEqual([0, 100, 200, 300]);
  });

  it('FR-LAY-006: spacing brings the gaps of a row within min and max, and leaves a box with no neighbour alone', () => {
    const nodes = [node('a', 0, box(0, 0)), node('b', 1, box(102, 0)), node('c', 2, box(500, 0)), node('far', 3, box(900, 600))];
    const out = applyConstraints(input(nodes, [{ type: 'spacing', min: 20, max: 40 }]), boxesOf(nodes));
    expect(['a', 'b', 'c'].map((id) => (out[id] as Box).x)).toEqual([0, 120, 260]);
    expect(out['far']).toEqual(box(900, 600));
  });

  it('FR-LAY-006: a later step never moves a box along an axis it is aligned on', () => {
    const nodes = [node('a', 0, box(0, 0)), node('b', 1, box(0, 100)), node('c', 2, box(0, 300))];
    const constraints: LayoutConstraint[] = [
      { type: 'align', axis: 'x', nodes: ['a', 'b'], at: 'start' },
      { type: 'order', axis: 'x', before: 'c', after: 'b', gap: 10 },
    ];
    const out = applyConstraints(input(nodes, constraints), boxesOf(nodes));
    expect((out['b'] as Box).x).toBe(0);
    expect((out['c'] as Box).x).toBe(-110);
  });

  it('FR-LAY-006: groups that share a node on one axis are one line (review M17.8 F2)', () => {
    const nodes = [node('a', 0, box(0, 0)), node('b', 1, box(200, 0)), node('c', 2, box(400, 300)), node('d', 3, box(600, 300))];
    const constraints: LayoutConstraint[] = [
      { type: 'align', axis: 'y', nodes: ['a', 'b'] },
      { type: 'align', axis: 'y', nodes: ['c', 'd'] },
      { type: 'align', axis: 'y', nodes: ['b', 'c'] },
    ];
    const out = applyConstraints(input(nodes, constraints), boxesOf(nodes));
    expect(new Set(['a', 'b', 'c', 'd'].map((id) => (out[id] as Box).y)).size).toBe(1);
  });

  it('FR-LAY-006: without constraints the pass returns the boxes it was given', () => {
    const nodes = [node('a', 0, box(3, 4))];
    const boxes = boxesOf(nodes);
    expect(applyConstraints({ frame, nodes }, boxes)).toBe(boxes);
  });

  it('FR-LAY-006: the pipeline refuses a constraint it cannot read', () => {
    const nodes = [node('a', 0, box(0, 0))];
    const bad = [
      { type: 'spacing', min: 10, max: 5 },
      { type: 'order', axis: 'x', before: 'a', after: 'a', gap: -1 },
      { type: 'stick' },
      // review M17.8 F1: these crashed the pass instead of being refused
      { type: 'align', axis: 'z', nodes: ['a', 'b'] },
      { type: 'order', axis: 'z', before: 'a', after: 'b' },
      { type: 'align', axis: 'x', nodes: ['a'], at: 'middle' },
      { type: 'sameRank', nodes: ['a'], axis: 'q' },
      { type: 'align', axis: 'x', nodes: [1, 2] },
      { type: 'order', axis: 'x', before: 1, after: 'a' },
      null,
    ];
    for (const c of bad) {
      const r = layoutSync({ input: input(nodes, [c as LayoutConstraint]), algorithm: asGiven });
      expect(r.ok ? undefined : r.error.code).toBe('LAYOUT_INPUT_INVALID');
    }
  });

  it('FR-LAY-006: overlap removal moves an aligned box only along its free axis', () => {
    const nodes = [node('a', 0, box(0, 0)), node('b', 1, box(10, 300)), node('c', 2, box(40, 10))];
    const out = layoutSync({ input: input(nodes, [{ type: 'align', axis: 'x', nodes: ['a', 'b', 'c'], at: 'start' }]), algorithm: asGiven });
    if (!out.ok) throw new Error(out.error.message);
    const placed = ['a', 'b', 'c'].map((id) => out.value.boxes[id] as Box);
    expect(new Set(placed.map((b) => b.x)).size).toBe(1);
    expect(out.value.metrics.overlaps).toBe(0);
  });
});

/** Random nodes, some pinned, in disjoint align groups of up to one pinned member each, plus order and spacing constraints. */
const scenes = fc
  .array(
    fc.record({
      x: fc.integer({ min: 0, max: 1600 }),
      y: fc.integer({ min: 0, max: 900 }),
      w: fc.integer({ min: 20, max: 200 }),
      h: fc.integer({ min: 20, max: 120 }),
      pinned: fc.integer({ min: 0, max: 5 }).map((v) => v === 0),
      group: fc.integer({ min: 0, max: 5 }),
    }),
    { minLength: 2, maxLength: 24 },
  )
  .chain((specs) =>
    fc.record({
      specs: fc.constant(specs),
      axes: fc.array(fc.constantFrom<'x' | 'y'>('x', 'y'), { minLength: 6, maxLength: 6 }),
      ats: fc.array(fc.constantFrom<'start' | 'center' | 'end'>('start', 'center', 'end'), { minLength: 6, maxLength: 6 }),
      orders: fc.array(fc.tuple(fc.nat(specs.length - 1), fc.nat(specs.length - 1), fc.constantFrom<'x' | 'y'>('x', 'y')), { maxLength: 6 }),
      spacing: fc.option(fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 30, max: 200 })), { nil: undefined }),
    }),
  );

type Generated = typeof scenes extends fc.Arbitrary<infer T> ? T : never;
type Scene = { nodes: LayoutNode[]; groups: Array<{ axis: 'x' | 'y'; at: 'start' | 'center' | 'end'; ids: string[] }>; constraints: LayoutConstraint[] };

/** A generated scene as nodes and constraints; group 0 is "no group", and only the first pinned member of a group keeps its pin. */
function sceneOf(s: Generated): Scene {
  const pinnedIn = new Set<number>();
  const nodes = s.specs.map((p, i) => {
    const pin = p.pinned && (p.group === 0 || !pinnedIn.has(p.group));
    if (pin) pinnedIn.add(p.group);
    return node(`n${i}`, i, box(p.x, p.y, p.w, p.h), pin);
  });
  const groups = [1, 2, 3, 4, 5]
    .map((g) => ({
      axis: s.axes[g] as 'x' | 'y',
      at: s.ats[g] as 'start' | 'center' | 'end',
      ids: nodes.filter((_, i) => s.specs[i]?.group === g).map((n) => n.id),
    }))
    .filter((g) => g.ids.length >= 2);
  const constraints: LayoutConstraint[] = [
    ...groups.map((g) => ({ type: 'align' as const, axis: g.axis, at: g.at, nodes: g.ids })),
    ...s.orders.map(([a, b, axis]) => ({ type: 'order' as const, axis, before: `n${a}`, after: `n${b}`, gap: 8 })),
    ...(s.spacing ? [{ type: 'spacing' as const, min: s.spacing[0], max: s.spacing[1] }] : []),
  ];
  return { nodes, groups, constraints };
}

/** No two boxes overlap unless both are pinned (FR-LAY-004 still holds with constraints). */
function expectApartUnlessBothPinned(nodes: readonly LayoutNode[], out: Readonly<Record<string, Box>>) {
  for (const [i, n] of nodes.entries()) {
    for (const m of nodes.slice(i + 1)) {
      const [a, b] = [out[n.id] as Box, out[m.id] as Box];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart || (n.pinned === true && m.pinned === true), `${n.id} ${m.id}`).toBe(true);
    }
  }
}

/** Pinned boxes are exact, sizes kept, no new overlap, and each align group on one coordinate within 0.5 px. */
function expectConstraintsKept({ nodes, groups, constraints }: Scene) {
  const r = layoutSync({ input: input(nodes, constraints), algorithm: asGiven });
  if (!r.ok) throw new Error(r.error.message);
  const out = r.value.boxes;
  for (const n of nodes) {
    const b = out[n.id] as Box;
    expect([b.w, b.h]).toEqual([n.box.w, n.box.h]);
    if (n.pinned) expect(b).toEqual(n.box);
  }
  expectApartUnlessBothPinned(nodes, out);
  for (const g of groups) {
    const points = g.ids.map((id) => pointOf(out[id] as Box, g.axis, g.at));
    expect(Math.max(...points) - Math.min(...points)).toBeLessThanOrEqual(0.5);
  }
}

describe('constraints through the pipeline (FR-LAY-006, property)', () => {
  it('FR-LAY-006: pinned boxes do not move and every aligned group shares its coordinate within 0.5 px after all post-passes, with no new overlap', () => {
    fc.assert(
      fc.property(scenes, (s) => expectConstraintsKept(sceneOf(s))),
      { numRuns: 200 },
    );
  });
});
