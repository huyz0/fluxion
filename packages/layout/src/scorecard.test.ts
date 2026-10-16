// FR-LAY-001 and FR-LAY-004: the layout scorecard (overlaps, crossings, bends, displacement) and its golden values for the `layered` fixtures.
import { describe, expect, it } from 'vitest';
import { layeredLayout, layoutSync, type Scorecard, scoreLayout } from './index.js';
import type { LayoutEdge, LayoutInput, LayoutNode } from './types.js';

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, order: number, at?: { x: number; y: number }): LayoutNode => ({
  id,
  box: { x: at?.x ?? 0, y: at?.y ?? 0, w: 100, h: 50 },
  order,
  ...(at ? { pinned: true } : {}),
});
const edges = (pairs: ReadonlyArray<readonly [string, string]>): LayoutEdge[] =>
  pairs.map(([source, target], order) => ({ id: `e${order}`, source, target, order }));
const graph = (ids: readonly string[], pairs: ReadonlyArray<readonly [string, string]>): LayoutInput => ({
  frame,
  nodes: ids.map((id, order) => node(id, order)),
  edges: edges(pairs),
});

/** The scorecard of `input` laid out by `layered` with its defaults. */
function layered(input: LayoutInput): { score: Scorecard; metrics: { crossings: number; bends: number; overlaps: number } } {
  const r = layoutSync({ input, algorithm: layeredLayout });
  if (!r.ok) throw new Error(r.error.message);
  return { score: scoreLayout(input, r.value.boxes), metrics: r.value.metrics };
}

/** The `layered` golden fixtures: a layout that gets worse on any column fails the matching line. */
const FIXTURES: ReadonlyArray<{ name: string; input: LayoutInput; golden: Scorecard }> = [
  {
    name: 'chain',
    input: graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    ),
    golden: { overlaps: 0, crossings: 0, bends: 0, displacement: 229 },
  },
  {
    name: 'diamond',
    input: graph(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b'],
        ['a', 'c'],
        ['b', 'd'],
        ['c', 'd'],
      ],
    ),
    golden: { overlaps: 0, crossings: 0, bends: 4, displacement: 268 },
  },
  {
    name: 'fan',
    input: graph(
      ['r', 'x', 'y', 'z'],
      [
        ['r', 'x'],
        ['r', 'y'],
        ['r', 'z'],
      ],
    ),
    golden: { overlaps: 0, crossings: 0, bends: 2, displacement: 295 },
  },
];

describe('the layout scorecard (FR-LAY-001, FR-LAY-004)', () => {
  it('FR-LAY-004: crossings and bends are counted from the edges, and are not 0 for a graph whose edges cross', () => {
    // a and d are on one diagonal, b and c on the other: the two edges cross once, and both are slanted
    const crossed: LayoutInput = {
      frame,
      nodes: [node('a', 0, { x: 0, y: 0 }), node('b', 1, { x: 300, y: 0 }), node('c', 2, { x: 0, y: 300 }), node('d', 3, { x: 300, y: 300 })],
      edges: edges([
        ['a', 'd'],
        ['b', 'c'],
      ]),
    };
    const r = layoutSync({ input: crossed, algorithm: layeredLayout });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.metrics).toMatchObject({ overlaps: 0, crossings: 1, bends: 2 });
    expect(scoreLayout(crossed, r.value.boxes)).toEqual({ overlaps: 0, crossings: 1, bends: 2, displacement: 0 });
  });

  it('FR-LAY-004: edges that share a node, loops and edges to unknown nodes do not cross anything', () => {
    const fan = graph(
      ['r', 'x', 'y'],
      [
        ['r', 'x'],
        ['r', 'y'],
        ['x', 'x'],
        ['y', 'ghost'],
      ],
    );
    expect(layered(fan).score.crossings).toBe(0);
  });

  for (const { name, input, golden } of FIXTURES)
    it(`FR-LAY-001: the layered fixture "${name}" keeps its golden scorecard, and the pipeline reports the same counts`, () => {
      const { score, metrics } = layered(input);
      // every fixture node starts at the origin, so displacement is the distance from there
      expect(score).toEqual(golden);
      expect(metrics).toMatchObject({ overlaps: score.overlaps, crossings: score.crossings, bends: score.bends });
    });

  it('FR-LAY-004: a placement that crosses scores worse than the layered result of the same graph', () => {
    const input = graph(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'c'],
        ['b', 'd'],
      ],
    );
    const good = layered(input).score;
    const scrambled: LayoutInput = {
      ...input,
      nodes: [node('a', 0, { x: 0, y: 0 }), node('b', 1, { x: 300, y: 0 }), node('c', 2, { x: 300, y: 300 }), node('d', 3, { x: 0, y: 300 })],
    };
    const bad = scoreLayout(scrambled, Object.fromEntries(scrambled.nodes.map((n) => [n.id, n.box])));
    expect(bad.crossings).toBeGreaterThan(good.crossings);
  });
});
