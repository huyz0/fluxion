// The built-in `mindmap` layout (05 §3, FR-LAY-003, ADR-0045): the tree of the edges (as `tree` builds it) with its root in the middle
// and the root's subtrees on two sides, right and left, each side a tidy tree growing away from the root (the left one mirrored). The
// subtrees are dealt to the sides largest first, each to the side whose height so far is less (ties to the right). On each side they keep
// their model order and are stacked edge to edge, a node gap apart, never nested into each other's contours, so a side's height is what
// the dealing counted and the two sides' heights differ by at most the tallest subtree plus one node gap. Any further roots of a forest
// are dealt as more subtrees. Each side is centred on the root's middle.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { type Ctx, compare, forestOf, GAPS, type Item, intoFrame, subtree } from './tree.js';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `mindmap` layout.
 *
 * @public
 */
export type MindmapOptions = {
  /** Preset for the two gaps: `compact`, `comfortable` (default) or `spacious`. */
  readonly spacing: 'compact' | 'comfortable' | 'spacious';
  /** Space between sibling subtrees, px (default: from `spacing`). */
  readonly nodeGap?: number | undefined;
  /** Space between a parent's box and its children, px (default: from `spacing`). */
  readonly rankGap?: number | undefined;
  /** Space between the frame's edge and the diagram, px (default 80). */
  readonly padding: number;
};

const SPACINGS = ['compact', 'comfortable', 'spacious'] as const;
const schema = z
  .strictObject({
    spacing: z.enum(SPACINGS).default('comfortable'),
    nodeGap: z.number().finite().min(0).optional(),
    rankGap: z.number().finite().min(0).optional(),
    padding: z.number().finite().min(0).default(80),
  })
  .default({ spacing: 'comfortable', padding: 80 });

/** Lowest and highest breadth of a subtree. */
const extent = (items: readonly Item[]) => [Math.min(...items.map((i) => i.x)), Math.max(...items.map((i) => i.x + i.s))] as const;

/**
 * The root's subtrees dealt to two sides, largest first, each to the side whose height so far is less (ties to the right); each side
 * keeps model order. `heights` are the subtrees' heights.
 */
export function dealSides(heights: readonly number[], gap: number): { readonly right: number[]; readonly left: number[] } {
  const total = { right: 0, left: 0 };
  const side = new Array<'right' | 'left'>(heights.length);
  const byHeight = heights.map((h, i) => [h, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [h, i] of byHeight) {
    const to = total.left < total.right ? 'left' : 'right';
    side[i] = to;
    total[to] += h + gap;
  }
  return { right: heights.flatMap((_, i) => (side[i] === 'right' ? [i] : [])), left: heights.flatMap((_, i) => (side[i] === 'left' ? [i] : [])) };
}

/**
 * `subtrees` stacked edge to edge along the breadth, `gap` apart; their items, moved. Not packed: contour packing would let a side's
 * subtrees nest into each other and break the balance the dealing counted.
 */
function stack(subtrees: readonly Item[][], gap: number): Item[] {
  const items: Item[] = [];
  let edge = 0;
  for (const part of subtrees) {
    const [lo, hi] = extent(part);
    for (const item of part) item.x += edge - lo;
    items.push(...part);
    edge += hi - lo + gap;
  }
  return items;
}

function run(input: LayoutInput, o: MindmapOptions): LayoutOutput {
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  if (nodes.length === 0) return { boxes: {} };
  const [nodeGap, rankGap] = GAPS[o.spacing];
  const forest = forestOf(nodes, input);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // tree space across: breadth is vertical, depth horizontal
  const c: Ctx = { forest, byId, gaps: { sibling: o.nodeGap ?? nodeGap, level: o.rankGap ?? rankGap, compactLeaves: false }, across: true };
  const [rootId, ...otherRoots] = forest.roots as [string, ...string[]];
  const root = byId.get(rootId) as (typeof nodes)[number];
  const parts = [...(forest.children.get(rootId) ?? []), ...otherRoots].map((id) => subtree(id, c));
  const heights = parts.map((p) => {
    const [lo, hi] = extent(p);
    return hi - lo;
  });
  const sides = dealSides(heights, c.gaps.sibling);
  const placed = new Map<string, Box>([[rootId, { x: -root.box.w / 2, y: -root.box.h / 2, w: root.box.w, h: root.box.h }]]);
  for (const [name, indices] of Object.entries(sides) as Array<['right' | 'left', number[]]>) {
    if (indices.length === 0) continue;
    const items = stack(
      indices.map((k) => parts[k] as Item[]),
      c.gaps.sibling,
    );
    const [lo, hi] = extent(items);
    const middle = (lo + hi) / 2;
    const start = root.box.w / 2 + c.gaps.level;
    for (const i of items) {
      const x = name === 'right' ? start + i.y : -(start + i.y + i.d);
      placed.set(i.id, { x, y: i.x - middle, w: i.d, h: i.s });
    }
  }
  return intoFrame(nodes, placed, input.frame, o.padding);
}

/**
 * The `mindmap` layout: the root in the middle and its subtrees on two balanced sides.
 *
 * @public
 */
export const mindmapLayout: LayoutAlgorithm<MindmapOptions> = {
  id: 'mindmap',
  describe: 'Mind map: the root in the middle and its branches on two balanced sides, right and left.',
  version: '1',
  schema,
  capabilities: { pins: true, compound: false, runsIn: 'either' },
  parseOptions(raw: unknown): OptionsResult<MindmapOptions> {
    const r = schema.safeParse(raw);
    if (r.success) return { ok: true, value: r.data };
    const issue = r.error.issues[0];
    return { ok: false, message: `mindmap options: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
  },
  run,
};
