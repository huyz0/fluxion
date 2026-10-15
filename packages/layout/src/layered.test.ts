// FR-LAY-002 and FR-LAY-008: the built-in `layered` layout (dagre), its determinism and its options.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gridLayout, type LayeredOptions, layeredLayout, stackLayout } from './index.js';
import type { LayoutEdge, LayoutNode } from './types.js';

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, [w, h]: readonly [number, number], order: number, at?: { x: number; y: number }): LayoutNode => ({
  id,
  box: { x: at?.x ?? 0, y: at?.y ?? 0, w, h },
  order,
  ...(at ? { pinned: true } : {}),
});
const edge = (id: string, source: string, target: string, order: number): LayoutEdge => ({ id, source, target, order });
const options = (raw: unknown): LayeredOptions => {
  const r = layeredLayout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const diamond = {
  nodes: [node('a', [100, 50], 0), node('b', [120, 60], 1), node('c', [80, 40], 2), node('d', [100, 50], 3)],
  edges: [edge('e0', 'a', 'b', 0), edge('e1', 'a', 'c', 1), edge('e2', 'b', 'd', 2), edge('e3', 'c', 'd', 3)],
};
const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('layered layout (FR-LAY-002, FR-LAY-008)', () => {
  it('FR-LAY-002: fixture layered-diamond gives golden boxes for each direction, ranks one rank gap apart', () => {
    const golden = {
      TB: { a: box(60, 0, 100, 50), b: box(120, 130, 120, 60), c: box(0, 140, 80, 40), d: box(60, 270, 100, 50) },
      LR: { a: box(0, 40, 100, 50), b: box(180, 80, 120, 60), c: box(200, 0, 80, 40), d: box(380, 40, 100, 50) },
      BT: { a: box(60, 270, 100, 50), b: box(120, 130, 120, 60), c: box(0, 140, 80, 40), d: box(60, 0, 100, 50) },
      RL: { a: box(380, 40, 100, 50), b: box(180, 80, 120, 60), c: box(200, 0, 80, 40), d: box(0, 40, 100, 50) },
    } as const;
    const words = { down: 'TB', right: 'LR', up: 'BT', left: 'RL' } as const;
    for (const direction of ['down', 'right', 'up', 'left'] as const) {
      const out = layeredLayout.run({ frame, ...diamond }, options({ direction, padding: 0 }));
      expect(out.boxes).toEqual(golden[words[direction]]);
    }
  });

  it('FR-LAY-002: padding and the frame origin set where the diagram starts, and the gaps are the configured ones', () => {
    const out = layeredLayout.run({ frame: { x: 100, y: 200, w: 800, h: 600 }, ...diamond }, options({ padding: 20, nodeGap: 10, rankGap: 30 }));
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => out.boxes[id] as ReturnType<typeof box>);
    const all = [a, b, c, d] as ReturnType<typeof box>[];
    expect(Math.min(...all.map((q) => q.x))).toBe(120);
    expect(Math.min(...all.map((q) => q.y))).toBe(220);
    expect((b?.y ?? 0) - ((a?.y ?? 0) + (a?.h ?? 0))).toBe(30);
    expect((b?.x ?? 0) - ((c?.x ?? 0) + (c?.w ?? 0))).toBe(10);
  });

  it('FR-LAY-008: the same input twice, and the same graph given in another order, give the same boxes', () => {
    const o = options({});
    const first = layeredLayout.run({ frame, ...diamond }, o);
    expect(layeredLayout.run({ frame, ...diamond }, o)).toEqual(first);
    const shuffled = { nodes: [...diamond.nodes].reverse(), edges: [...diamond.edges].reverse() };
    expect(layeredLayout.run({ frame, ...shuffled }, o)).toEqual(first);
  });

  it('FR-LAY-008: ids such as constructor and __proto__ are laid out like any other', () => {
    const odd = {
      nodes: [node('constructor', [100, 50], 0), node('__proto__', [120, 60], 1), node('toString', [80, 40], 2)],
      edges: [edge('e0', 'constructor', '__proto__', 0), edge('e1', 'constructor', 'toString', 1)],
    };
    const out = layeredLayout.run({ frame, ...odd }, options({ padding: 0 }));
    expect(Object.keys(out.boxes).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    const renamed = { nodes: odd.nodes.map((n, i) => ({ ...n, id: `x${i}` })), edges: [edge('e0', 'x0', 'x1', 0), edge('e1', 'x0', 'x2', 1)] };
    const plain = layeredLayout.run({ frame, ...renamed }, options({ padding: 0 }));
    expect(Object.values(out.boxes)).toEqual(Object.values(plain.boxes));
  });

  it('FR-LAY-002: pinned nodes keep their boxes, still rank through their edges, and the rest start at the padded frame origin', () => {
    const pin = node('p', [90, 30], 0, { x: 700, y: 500 });
    const out = layeredLayout.run(
      { frame, nodes: [pin, node('a', [100, 50], 1), node('b', [100, 50], 2)], edges: [edge('e0', 'p', 'a', 0), edge('e1', 'a', 'b', 1)] },
      options({ padding: 80 }),
    );
    expect(out.boxes['p']).toEqual(pin.box);
    // p ranks above a, and a above b, whatever p's own box
    expect(out.boxes['a']).toEqual(box(80, 80, 100, 50));
    expect(out.boxes['b']?.y).toBe(80 + 50 + 80);
  });

  it('FR-LAY-002: unconnected nodes, an empty input, self loops, duplicate edges and edges to unknown nodes all lay out', () => {
    expect(layeredLayout.run({ frame, nodes: [] }, options({})).boxes).toEqual({});
    const lone = layeredLayout.run({ frame, nodes: [node('a', [10, 10], 0), node('b', [10, 10], 1)] }, options({ padding: 0 }));
    expect(lone.boxes['a']?.y).toBe(lone.boxes['b']?.y);
    const odd = layeredLayout.run(
      {
        frame,
        nodes: [node('a', [10, 10], 0), node('b', [10, 10], 1)],
        edges: [edge('s', 'a', 'a', 0), edge('d1', 'a', 'b', 1), edge('d2', 'a', 'b', 2), edge('u', 'a', 'ghost', 3)],
      },
      options({ padding: 0 }),
    );
    expect(odd.boxes['b']?.y).toBe(10 + 80);
  });

  it('FR-LAY-008: for any graph the output is deterministic, covers every node, and boxes keep their sizes', () => {
    const graph = fc.integer({ min: 1, max: 9 }).chain((count) =>
      fc.record({
        sizes: fc.array(fc.tuple(fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 120 })), { minLength: count, maxLength: count }),
        links: fc.array(fc.tuple(fc.integer({ min: 0, max: count - 1 }), fc.integer({ min: 0, max: count - 1 })), { maxLength: 14 }),
        direction: fc.constantFrom('down', 'right', 'up', 'left'),
      }),
    );
    fc.assert(
      fc.property(graph, ({ sizes, links, direction }) => {
        const nodes = sizes.map(([w, h], i) => node(`n${i}`, [w, h], i));
        const edges = links.map(([s, t], i) => edge(`e${i}`, `n${s}`, `n${t}`, i));
        const o = options({ direction });
        const first = layeredLayout.run({ frame, nodes, edges }, o);
        expect(layeredLayout.run({ frame, nodes, edges }, o)).toEqual(first);
        for (const n of nodes) expect(first.boxes[n.id]).toMatchObject({ w: n.box.w, h: n.box.h });
      }),
      { numRuns: 150, seed: 20261015 },
    );
  });

  it('FR-LAY-002: spacing presets set the gaps, and nodeGap and rankGap override them', () => {
    const gaps = (raw: unknown) => {
      const out = layeredLayout.run({ frame, ...diamond }, options({ padding: 0, ...(raw as object) }));
      const { a, b, c } = out.boxes as Record<string, ReturnType<typeof box>>;
      return [(b?.y ?? 0) - ((a?.y ?? 0) + (a?.h ?? 0)), (b?.x ?? 0) - ((c?.x ?? 0) + (c?.w ?? 0))];
    };
    expect(gaps({})).toEqual([80, 40]);
    expect(gaps({ spacing: 'compact' })).toEqual([48, 24]);
    expect(gaps({ spacing: 'spacious' })).toEqual([120, 64]);
    expect(gaps({ spacing: 'compact', rankGap: 10, nodeGap: 5 })).toEqual([10, 5]);
  });

  it('FR-LAY-001: the layered options are checked with a message naming the bad one, and the schema agrees', () => {
    expect(layeredLayout.parseOptions(undefined)).toEqual({ ok: true, value: { direction: 'down', spacing: 'comfortable', padding: 80 } });
    for (const [raw, message] of [
      [{ direction: 'TB' }, 'direction must be "down", "right", "up" or "left"'],
      [{ spacing: 'wide' }, 'spacing must be "compact", "comfortable" or "spacious"'],
      [{ nodeGap: -1 }, 'nodeGap must be a number of px, 0 or more'],
      [{ rankGap: Number.NaN }, 'rankGap must be a number of px, 0 or more'],
      [{ ranker: 'tight-tree' }, 'unknown layered option "ranker" (direction, spacing, nodeGap, rankGap, padding)'],
      [null, 'layered options must be an object'],
    ] as const) {
      expect(layeredLayout.parseOptions(raw)).toEqual({ ok: false, message });
      expect(layeredLayout.schema.safeParse(raw).success).toBe(false);
    }
    expect(layeredLayout.parseOptions({ direction: undefined, rankGap: 5 })).toEqual({
      ok: true,
      value: { direction: 'down', spacing: 'comfortable', rankGap: 5, padding: 80 },
    });
    expect(layeredLayout.schema.parse({ direction: 'right' })).toEqual({ direction: 'right', spacing: 'comfortable', padding: 80 });
  });
  it('FR-LAY-008: every built-in keeps a box for a node whose id is __proto__', () => {
    const nodes = [node('__proto__', [10, 10], 0), node('ok', [10, 10], 1), node('pin', [10, 10], 2, { x: 500, y: 500 })];
    for (const layout of [stackLayout, gridLayout, layeredLayout]) {
      const o = layout.parseOptions(undefined);
      if (!o.ok) throw new Error(o.message);
      const out = layout.run({ frame, nodes, edges: [edge('e', '__proto__', 'ok', 0)] }, o.value as never);
      expect(Object.keys(out.boxes).sort()).toEqual(['__proto__', 'ok', 'pin']);
    }
  });
});
