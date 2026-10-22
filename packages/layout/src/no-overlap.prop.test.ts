// FR-LAY-004 and FR-LAY-008: over random graphs, every built-in layout followed by the post-passes (pins, overlap, snap) leaves no unpinned box
// overlapping another, leaves pinned boxes exactly where they were, keeps sizes, and gives the same boxes when run again.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyPins,
  circularLayout,
  forceLayout,
  gridLayout,
  layeredLayout,
  mindmapLayout,
  orgchartLayout,
  packingLayout,
  radialLayout,
  removeOverlap,
  snapBoxes,
  stackLayout,
  swimlaneLayout,
  timelineLayout,
  treeLayout,
} from './index.js';
import type { Boxes } from './passes.js';
import type { LayoutAlgorithm, LayoutEdge, LayoutInput, LayoutNode } from './types.js';

type Placed = { x: number; y: number; w: number; h: number };
const gap = (a: Placed, b: Placed) => Math.max(Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));

/** Every built-in with random options it accepts. */
const ALGORITHMS: ReadonlyArray<readonly [string, LayoutAlgorithm<never>, fc.Arbitrary<unknown>]> = [
  [
    'stack',
    stackLayout as never,
    fc.record({
      direction: fc.constantFrom('down', 'right'),
      gap: fc.integer({ min: 0, max: 60 }),
      align: fc.constantFrom('start', 'center', 'end'),
      wrap: fc.constantFrom(0, 300, 700),
    }),
  ],
  [
    'grid',
    gridLayout as never,
    fc.record({ columns: fc.integer({ min: 1, max: 6 }), gap: fc.integer({ min: 0, max: 60 }), align: fc.constantFrom('start', 'center', 'end') }),
  ],
  [
    'layered',
    layeredLayout as never,
    fc.record({ direction: fc.constantFrom('down', 'right', 'up', 'left'), spacing: fc.constantFrom('compact', 'comfortable', 'spacious') }),
  ],
  [
    'tree',
    treeLayout as never,
    fc.record({
      direction: fc.constantFrom('down', 'right', 'up', 'left'),
      spacing: fc.constantFrom('compact', 'comfortable', 'spacious'),
      compactLeaves: fc.boolean(),
    }),
  ],
  ['orgchart', orgchartLayout as never, fc.record({ direction: fc.constantFrom('down', 'right', 'up', 'left') })],
  ['radial', radialLayout as never, fc.record({ spacing: fc.constantFrom('compact', 'comfortable', 'spacious') })],
  ['force', forceLayout as never, fc.record({ iterations: fc.integer({ min: 1, max: 60 }), spacing: fc.constantFrom('compact', 'comfortable', 'spacious') })],
  ['mindmap', mindmapLayout as never, fc.record({ spacing: fc.constantFrom('compact', 'comfortable', 'spacious') })],
  ['circular', circularLayout as never, fc.record({ spacing: fc.constantFrom('compact', 'comfortable', 'spacious') })],
  ['packing', packingLayout as never, fc.record({ spacing: fc.constantFrom('compact', 'comfortable', 'spacious') })],
  ['timeline', timelineLayout as never, fc.record({ spacing: fc.constantFrom('compact', 'comfortable', 'spacious') })],
  ['swimlane', swimlaneLayout as never, fc.record({ spacing: fc.constantFrom('compact', 'comfortable', 'spacious') })],
];

const graph = fc.integer({ min: 1, max: 14 }).chain((count) =>
  fc.record({
    nodes: fc.array(
      fc.record({
        w: fc.integer({ min: 1, max: 220 }),
        h: fc.integer({ min: 1, max: 140 }),
        pin: fc.option(fc.record({ x: fc.integer({ min: 0, max: 900 }), y: fc.integer({ min: 0, max: 600 }) }), { nil: undefined }),
      }),
      { minLength: count, maxLength: count },
    ),
    links: fc.array(fc.tuple(fc.integer({ min: 0, max: count - 1 }), fc.integer({ min: 0, max: count - 1 })), { maxLength: 18 }),
  }),
);

function pipeline(algorithm: LayoutAlgorithm<never>, raw: unknown, input: LayoutInput): Boxes {
  const options = algorithm.parseOptions(raw);
  if (!options.ok) throw new Error(options.message);
  const placed = algorithm.run(input, options.value as never).boxes;
  return snapBoxes(input, removeOverlap(input, applyPins(input, placed)));
}

/** Sizes are kept, pinned boxes are exact, and every unpinned box is clear of every other (snap moves an edge by at most 0.25 px, so the 1 px margin leaves 0.5). */
function expectClear(name: string, nodes: readonly LayoutNode[], out: Boxes): void {
  for (const n of nodes) {
    const b = out[n.id] as Placed;
    expect([b.w, b.h], name).toEqual([n.box.w, n.box.h]);
    if (n.pinned) expect(b, name).toEqual(n.box);
    else for (const o of nodes.filter((m) => m !== n)) expect(gap(b, out[o.id] as Placed), name).toBeGreaterThanOrEqual(0.5 - 1e-6);
  }
}

describe('no overlap, any layout (FR-LAY-004, FR-LAY-008)', () => {
  it('FR-LAY-004: for random graphs, every built-in plus the post-passes leaves unpinned boxes clear of every other box and pinned boxes unmoved', () => {
    for (const [name, algorithm, optionsArb] of ALGORITHMS) {
      fc.assert(
        fc.property(graph, optionsArb, ({ nodes: shapes, links }, raw) => {
          const nodes: LayoutNode[] = shapes.map((s, i) => ({
            id: `n${i}`,
            box: { x: s.pin?.x ?? 0, y: s.pin?.y ?? 0, w: s.w, h: s.h },
            order: i,
            ...(s.pin ? { pinned: true } : {}),
          }));
          const edges: LayoutEdge[] = links.map(([from, to], i) => ({ id: `e${i}`, source: `n${from}`, target: `n${to}`, order: i }));
          const input: LayoutInput = { frame: { x: 0, y: 0, w: 1920, h: 1080 }, nodes, edges };
          const out = pipeline(algorithm, raw, input);
          expect(pipeline(algorithm, raw, input), name).toEqual(out);
          expectClear(name, nodes, out);
        }),
      );
    }
  });
});
