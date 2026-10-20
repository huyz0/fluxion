// FR-LAY-003 and FR-LAY-008: the built-in `force` layout: seeded, deterministic, linked boxes closer than unlinked ones.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type ForceOptions, forceLayout } from './force.js';
import { createRng } from './rng.js';
import type { LayoutCtx, LayoutEdge, LayoutInput, LayoutNode } from './types.js';

type Placed = { x: number; y: number; w: number; h: number };
const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, w: number, h: number, order: number): LayoutNode => ({ id, box: { x: 0, y: 0, w, h }, order });
const edge = (id: string, source: string, target: string, order: number): LayoutEdge => ({ id, source, target, order });
const options = (raw: unknown): ForceOptions => {
  const r = forceLayout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const ctx = (seed: number): LayoutCtx => ({ rng: createRng(seed), measure: { measure: () => ({ w: 0, h: 0 }) } as never, signal: { aborted: false } });
const centre = (b: Placed | undefined) => [(b?.x ?? 0) + (b?.w ?? 0) / 2, (b?.y ?? 0) + (b?.h ?? 0) / 2] as const;
const distance = (a: Placed | undefined, b: Placed | undefined) => {
  const [[ax, ay], [bx, by]] = [centre(a), centre(b)];
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
};

const graph = fc.integer({ min: 1, max: 24 }).chain((count) =>
  fc.record({
    sizes: fc.array(fc.tuple(fc.integer({ min: 1, max: 220 }), fc.integer({ min: 1, max: 140 })), { minLength: count, maxLength: count }),
    links: fc.array(fc.tuple(fc.integer({ min: 0, max: count - 1 }), fc.integer({ min: 0, max: count - 1 })), { maxLength: 30 }),
  }),
);
const graphInput = ({ sizes, links }: { sizes: Array<[number, number]>; links: Array<[number, number]> }): LayoutInput => ({
  frame,
  nodes: sizes.map(([w, h], i) => node(`n${i}`, w, h, i)),
  edges: links.map(([a, b], i) => edge(`e${i}`, `n${a}`, `n${b}`, i)),
});

/** Two rings of 6 boxes joined by one edge. */
function twoRings(): LayoutInput {
  const nodes = Array.from({ length: 12 }, (_, i) => node(`v${i}`, 80, 40, i));
  const edges = Array.from({ length: 12 }, (_, i) => edge(`r${i}`, `v${i}`, `v${(i % 6) + 1 === 6 ? i - 5 : i + 1}`, i));
  return { frame, nodes, edges: [...edges, edge('bridge', 'v0', 'v6', 12)] };
}

describe('force layout (FR-LAY-003)', () => {
  it('FR-LAY-008: the same graph and seed give identical boxes; another seed gives other boxes; input order does not matter', () => {
    fc.assert(
      fc.property(graph, fc.integer(), fc.integer({ min: 1, max: 80 }), (g, seed, iterations) => {
        const input = graphInput(g);
        const o = options({ iterations });
        const first = forceLayout.run(input, o, ctx(seed));
        expect(forceLayout.run(input, o, ctx(seed))).toEqual(first);
        const reversed = { ...input, nodes: [...input.nodes].reverse(), edges: [...(input.edges ?? [])].reverse() };
        expect(forceLayout.run(reversed, o, ctx(seed))).toEqual(first);
        for (const b of Object.values(first.boxes)) expect([b.x * 2, b.y * 2].every(Number.isInteger)).toBe(true);
      }),
    );
    const input = twoRings();
    expect(forceLayout.run(input, options({}), ctx(1))).not.toEqual(forceLayout.run(input, options({}), ctx(2)));
  });

  it('FR-LAY-003: golden force-two-rings: the boxes of a fixed graph and seed, so a change in arithmetic is seen', () => {
    const out = forceLayout.run(twoRings(), options({ iterations: 120 }), ctx(7)).boxes;
    expect(Object.entries(out).map(([id, b]) => `${id} ${b.x},${b.y}`)).toEqual(GOLDEN_FORCE_TWO_RINGS);
  });

  it('FR-LAY-003: linked boxes end closer than unlinked ones: each ring stays together', () => {
    const input = twoRings();
    for (const seed of [1, 2, 3]) {
      const out = forceLayout.run(input, options({}), ctx(seed)).boxes as Record<string, Placed>;
      const ring = (i: number) => (i < 6 ? 0 : 1);
      const pairs = input.nodes.flatMap((a, i) => input.nodes.slice(i + 1).map((b, j) => [a.id, b.id, ring(i) === ring(i + 1 + j)] as const));
      const mean = (same: boolean) => {
        const ds = pairs.filter((p) => p[2] === same).map(([a, b]) => distance(out[a], out[b]));
        return ds.reduce((s, d) => s + d, 0) / ds.length;
      };
      expect(mean(true)).toBeLessThan(mean(false));
    }
  });

  it('FR-LAY-008: pinned nodes keep their boxes and still pull their links; odd ids work; no nodes, no boxes', () => {
    const input: LayoutInput = {
      frame,
      nodes: [{ ...node('__proto__', 60, 30, 0), pinned: true, box: { x: 900, y: 500, w: 60, h: 30 } }, node('constructor', 80, 40, 1), node('far', 80, 40, 2)],
      edges: [edge('e0', '__proto__', 'constructor', 0)],
    };
    const out = forceLayout.run(input, options({}), ctx(3)).boxes;
    expect(out['__proto__']).toEqual({ x: 900, y: 500, w: 60, h: 30 });
    // the box linked to the pin ends near it, closer than the unlinked one (review M17.5 F1)
    expect(distance(out['constructor'], out['__proto__'])).toBeLessThan(distance(out['far'], out['__proto__']));
    expect(distance(out['constructor'], out['__proto__'])).toBeLessThan(400);
    expect(Object.keys(out).sort()).toEqual(['__proto__', 'constructor', 'far']);
    expect(forceLayout.run({ frame, nodes: [] }, options({}), ctx(3))).toEqual({ boxes: {} });
    // without a context the stream of seed 0 is used
    expect(forceLayout.run(input, options({}))).toEqual(forceLayout.run(input, options({}), ctx(0)));
  });

  it('FR-LAY-003: boxes of no size with no gap still get finite boxes (review M17.5 F2)', () => {
    const input: LayoutInput = { frame, nodes: [node('a', 0, 0, 0), node('b', 0, 0, 1)], edges: [edge('e', 'a', 'b', 0)] };
    const out = forceLayout.run(input, options({ nodeGap: 0 }), ctx(1)).boxes;
    expect(Object.values(out).every((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite))).toBe(true);
  });

  it('FR-LAY-001: options are checked against the schema', () => {
    expect(forceLayout.parseOptions({ iterations: 0 })).toMatchObject({ ok: false });
    expect(forceLayout.parseOptions({ iterations: 2.5 })).toMatchObject({ ok: false });
    expect(forceLayout.parseOptions({ direction: 'down' })).toMatchObject({ ok: false });
    expect(options(undefined)).toEqual({ iterations: 300, spacing: 'comfortable', padding: 80 });
  });
});

// regenerate only for a deliberate change to the algorithm, with the reason in the commit and a `version` bump
const GOLDEN_FORCE_TWO_RINGS: readonly string[] = [
  'v0 388,561.5',
  'v1 390.5,323.5',
  'v2 304.5,127',
  'v3 132.5,80',
  'v4 80,250',
  'v5 195,429',
  'v6 518.5,836.5',
  'v7 499,1070',
  'v8 566,1272.5',
  'v9 730.5,1339.5',
  'v10 802.5,1177',
  'v11 704.5,986',
];
