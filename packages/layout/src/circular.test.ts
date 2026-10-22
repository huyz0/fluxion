// FR-LAY-003: the built-in `circular` layout: nodes evenly spaced on a circle, one circle per partition, no two boxes overlapping.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CircularOptions, circularLayout } from './circular.js';
import type { LayoutInput, LayoutNode } from './types.js';

type Placed = { x: number; y: number; w: number; h: number };
const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, w: number, h: number, order: number): LayoutNode => ({ id, box: { x: 0, y: 0, w, h }, order });
const inPartition = (n: LayoutNode, partition: string | undefined): LayoutNode => (partition === undefined ? n : { ...n, hints: { partition } });
const options = (raw: unknown): CircularOptions => {
  const r = circularLayout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const overlap = (a: Placed, b: Placed) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const centre = (b: Placed) => [b.x + b.w / 2, b.y + b.h / 2] as const;

/** Every box keeps its node's size and no two overlap. */
function expectSizesKeptAndNoOverlap(input: LayoutInput, out: Readonly<Record<string, Placed>>) {
  const placed = input.nodes.map((n) => out[n.id] as Placed);
  for (const [i, b] of placed.entries()) {
    expect([b.w, b.h]).toEqual([input.nodes[i]?.box.w, input.nodes[i]?.box.h]);
    for (const o of placed.slice(i + 1)) expect(overlap(b, o)).toBe(false);
  }
}

/** Every centre of `ring` is the same distance from their mean centre. */
function expectOnOneCircle(ring: ReadonlyArray<readonly [number, number]>) {
  if (ring.length < 2) return;
  const [mx, my] = [ring.reduce((s, c) => s + c[0], 0) / ring.length, ring.reduce((s, c) => s + c[1], 0) / ring.length];
  const radii = ring.map(([x, y]) => Math.sqrt((x - mx) ** 2 + (y - my) ** 2));
  for (const r of radii) expect(Math.abs(r - (radii[0] as number))).toBeLessThan(1e-6 * Math.max(1, r));
}

/** Fixture circular-12: a cycle of 12 steps of three sizes. The golden is the top-left corners, to 0.1 px. */
function cycleFixture(): LayoutInput {
  return { frame, nodes: Array.from({ length: 12 }, (_, i) => node(`s${i}`, 100 + (i % 3) * 30, 40 + (i % 2) * 20, i)) };
}

describe('circular layout (FR-LAY-003)', () => {
  it('FR-LAY-003: golden circular-12, a cycle of twelve steps', () => {
    const input = cycleFixture();
    const out = circularLayout.run(input, options(undefined)).boxes as Record<string, Placed>;
    const corners = input.nodes.map((n) => `${n.id} ${(out[n.id] as Placed).x.toFixed(1)},${(out[n.id] as Placed).y.toFixed(1)}`);
    expect(corners).toEqual(GOLDEN_CIRCULAR_12);
  });

  it('FR-LAY-003: for random boxes and partitions, no two boxes overlap and each circle is evenly spaced', () => {
    const sets = fc.array(fc.tuple(fc.integer({ min: 1, max: 220 }), fc.integer({ min: 1, max: 140 }), fc.constantFrom(undefined, 'a', 'b', 'c')), {
      minLength: 1,
      maxLength: 30,
    });
    fc.assert(
      fc.property(sets, fc.constantFrom('compact', 'comfortable', 'spacious'), (boxes, spacing) => {
        const input: LayoutInput = { frame, nodes: boxes.map(([w, h, p], i) => inPartition(node(`n${i}`, w, h, i), p)) };
        const out = circularLayout.run(input, options({ spacing })).boxes as Record<string, Placed>;
        expectSizesKeptAndNoOverlap(input, out);
        for (const p of [undefined, 'a', 'b', 'c'])
          expectOnOneCircle(input.nodes.filter((n) => n.hints?.['partition'] === p).map((n) => centre(out[n.id] as Placed)));
      }),
    );
  });

  it('FR-LAY-003: the first node is at the top and the others follow clockwise; partitions sit left to right in first-seen order', () => {
    const input: LayoutInput = {
      frame,
      nodes: ['right', 'left', 'right', 'left'].map((p, i) => inPartition(node('abcd'[i] as string, 50, 50, i), p)),
    };
    const out = circularLayout.run(input, options({ padding: 0 })).boxes as Record<string, Placed>;
    // 'right' was seen first, so its circle is on the left
    expect(Math.max(...['a', 'c'].map((id) => (out[id] as Placed).x))).toBeLessThan(Math.min(...['b', 'd'].map((id) => (out[id] as Placed).x)));
    const four = circularLayout.run({ frame, nodes: ['n', 'e', 's', 'w'].map((id, i) => node(id, 40, 40, i)) }, options({ padding: 0 })).boxes;
    const [n, e, s, w] = ['n', 'e', 's', 'w'].map((id) => centre(four[id] as Placed));
    expect((n as readonly number[])[1]).toBeLessThan((e as readonly number[])[1] as number);
    expect((e as readonly number[])[0]).toBeGreaterThan((w as readonly number[])[0] as number);
    expect((s as readonly number[])[1]).toBeGreaterThan((e as readonly number[])[1] as number);
  });

  it('FR-LAY-008: the same nodes in another order give the same boxes; pinned nodes keep theirs; odd ids work; one node sits at the padding', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('constructor', 80, 40, 0), { ...node('__proto__', 60, 30, 1), pinned: true, box: { x: 5, y: 6, w: 60, h: 30 } }, node('c', 70, 30, 2)],
    };
    const o = options({});
    const first = circularLayout.run(input, o);
    expect(circularLayout.run({ ...input, nodes: [...input.nodes].reverse() }, o)).toEqual(first);
    expect(Object.keys(first.boxes).sort()).toEqual(['__proto__', 'c', 'constructor']);
    expect(first.boxes['__proto__']).toEqual({ x: 5, y: 6, w: 60, h: 30 });
    expect(circularLayout.run({ frame, nodes: [] }, o)).toEqual({ boxes: {} });
    expect(circularLayout.run({ frame, nodes: [node('only', 10, 10, 0)] }, o).boxes['only']).toEqual({ x: 80, y: 80, w: 10, h: 10 });
  });

  it('FR-LAY-001: options are checked against the schema', () => {
    expect(circularLayout.parseOptions({ spacing: 'roomy' })).toMatchObject({ ok: false });
    expect(circularLayout.parseOptions({ direction: 'down' })).toMatchObject({ ok: false });
    expect(options(undefined)).toEqual({ spacing: 'comfortable', padding: 80 });
  });
});

// regenerate only for a deliberate change to the algorithm, with the reason in the commit and a `version` bump
const GOLDEN_CIRCULAR_12: readonly string[] = [
  's0 454.9,80.0',
  's1 627.3,120.2',
  's2 749.5,267.4',
  's3 829.8,444.9',
  's4 764.5,642.3',
  's5 612.3,769.5',
  's6 454.9,829.8',
  's7 252.4,769.5',
  's8 100.2,642.3',
  's9 80.0,444.9',
  's10 115.2,267.4',
  's11 237.4,120.2',
];
