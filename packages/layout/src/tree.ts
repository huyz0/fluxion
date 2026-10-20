// The built-in `tree` and `orgchart` layouts (05 §3, FR-LAY-003, ADR-0045): a non-layered tidy tree for boxes of any size. Each child
// subtree hangs one level gap below its own parent's box, not on a shared rank, so a tall box pushes down only its own descendants.
// Sibling subtrees are packed side by side as close as their boxes allow, and a parent is centred over its first and last child. The
// tree comes from the edges: in canonical order (model order, then id), each edge gives its target a parent unless the target has one
// or the edge would close a cycle; nodes left without a parent are the roots of a forest. `orgchart` is the same tree with
// `compactLeaves` on: a parent whose children are all leaves stacks them in one column under it. Pins, overlap with pins, rounding
// and the cache are the pipeline's (ADR-0033); a pinned node takes part in the tree and keeps its box.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import type { LayoutAlgorithm, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `tree` and `orgchart` layouts.
 *
 * @public
 */
export type TreeOptions = {
  /** Where children grow from their parent: `down` (default), `right`, `up` or `left`. */
  readonly direction: 'down' | 'right' | 'up' | 'left';
  /** Preset for the two gaps: `compact`, `comfortable` (default) or `spacious`. */
  readonly spacing: 'compact' | 'comfortable' | 'spacious';
  /** Space between sibling subtrees, px (default: from `spacing`). */
  readonly nodeGap?: number | undefined;
  /** Space between a parent's box and its children, px (default: from `spacing`). */
  readonly rankGap?: number | undefined;
  /** Space between the frame's edge and the diagram, px (default 80). */
  readonly padding: number;
  /** Stack the children of a parent whose children are all leaves in one column (default: off for `tree`, on for `orgchart`). */
  readonly compactLeaves: boolean;
};

const DIRECTIONS = ['down', 'right', 'up', 'left'] as const;
const SPACINGS = ['compact', 'comfortable', 'spacious'] as const;
/** The node gap and rank gap of each spacing preset, px (as `layered`'s). */
const GAPS = { compact: [24, 48], comfortable: [40, 80], spacious: [64, 120] } as const;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const schemaWith = (compactLeaves: boolean) =>
  z
    .strictObject({
      direction: z.enum(DIRECTIONS).default('down'),
      spacing: z.enum(SPACINGS).default('comfortable'),
      nodeGap: z.number().finite().min(0).optional(),
      rankGap: z.number().finite().min(0).optional(),
      padding: z.number().finite().min(0).default(80),
      compactLeaves: z.boolean().default(compactLeaves),
    })
    .default({ direction: 'down', spacing: 'comfortable', padding: 80, compactLeaves });

/** A box in tree space: `x` across siblings (breadth), `y` away from the root (depth); `s` and `d` its sizes along them. */
type Item = { readonly id: string; x: number; y: number; readonly s: number; readonly d: number };
type Gaps = { readonly sibling: number; readonly level: number; readonly compactLeaves: boolean };
type Forest = { readonly children: ReadonlyMap<string, readonly string[]>; readonly roots: readonly string[] };

/** Whether `ancestor` is `id` or above it in `parent`. */
function above(parent: ReadonlyMap<string, string>, id: string, ancestor: string): boolean {
  for (let at: string | undefined = id; at !== undefined; at = parent.get(at)) if (at === ancestor) return true;
  return false;
}

/** The forest the edges give `nodes` (in canonical order): children by parent in edge order, and the roots. */
function forestOf(nodes: readonly LayoutNode[], input: LayoutInput): Forest {
  const known = new Set(nodes.map((n) => n.id));
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of [...(input.edges ?? [])].sort((a, b) => a.order - b.order || compare(a.id, b.id))) {
    if (!known.has(e.source) || !known.has(e.target) || e.source === e.target || parent.has(e.target)) continue;
    if (above(parent, e.source, e.target)) continue;
    parent.set(e.target, e.source);
    children.get(e.source)?.push(e.target);
  }
  return { children, roots: nodes.filter((n) => !parent.has(n.id)).map((n) => n.id) };
}

/** How far `right` must move along the breadth so that no box of it comes within `gap` of a box of `left` it shares depth with. */
function separation(left: readonly Item[], right: readonly Item[], gap: number): number {
  let shift = Number.NEGATIVE_INFINITY;
  for (const b of right) for (const a of left) if (a.y < b.y + b.d && b.y < a.y + a.d) shift = Math.max(shift, a.x + a.s + gap - b.x);
  return shift;
}

/** `subtrees` packed side by side, each as close to the previous ones as `gap` allows; their items, moved. */
function pack(subtrees: readonly Item[][], gap: number): Item[] {
  const placed: Item[] = [];
  let edge = 0;
  for (const items of subtrees) {
    const shift = placed.length === 0 ? -Math.min(...items.map((i) => i.x)) : separation(placed, items, gap);
    // subtrees that share no depth (never, for siblings one gap below their parent) still keep their order
    const by = Number.isFinite(shift) ? shift : edge - Math.min(...items.map((i) => i.x));
    for (const i of items) i.x += by;
    placed.push(...items);
    edge = Math.max(...placed.map((i) => i.x + i.s)) + gap;
  }
  return placed;
}

/** Breadth and depth sizes of a node for a direction. */
const sizes = (n: LayoutNode, across: boolean) => (across ? { s: n.box.h, d: n.box.w } : { s: n.box.w, d: n.box.h });

type Ctx = { readonly forest: Forest; readonly byId: ReadonlyMap<string, LayoutNode>; readonly gaps: Gaps; readonly across: boolean };

/** The subtree of `id` in tree space, its root's box at depth 0. */
function subtree(id: string, c: Ctx): Item[] {
  const node = c.byId.get(id) as LayoutNode;
  const root: Item = { id, x: 0, y: 0, ...sizes(node, c.across) };
  const kids = c.forest.children.get(id) ?? [];
  if (kids.length === 0) return [root];
  const below = root.d + c.gaps.level;
  if (c.gaps.compactLeaves && kids.length > 1 && kids.every((k) => (c.forest.children.get(k) ?? []).length === 0)) {
    // one column of leaves, centred under the parent
    const column: Item[] = [];
    let y = below;
    for (const k of kids) {
      const size = sizes(c.byId.get(k) as LayoutNode, c.across);
      column.push({ id: k, x: (root.s - size.s) / 2, y, ...size });
      y += size.d + c.gaps.sibling / 2;
    }
    return [root, ...column];
  }
  const parts = kids.map((k) => subtree(k, c));
  for (const part of parts) for (const i of part) i.y += below;
  const packed = pack(parts, c.gaps.sibling);
  const centre = (part: readonly Item[]) => (part[0] as Item).x + (part[0] as Item).s / 2;
  root.x = (centre(parts[0] as Item[]) + centre(parts[parts.length - 1] as Item[])) / 2 - root.s / 2;
  return [root, ...packed];
}

/** A tree-space item as a box for `direction`, before the move into the frame. */
function toBox(i: Item, direction: TreeOptions['direction']): Box {
  if (direction === 'down') return { x: i.x, y: i.y, w: i.s, h: i.d };
  if (direction === 'up') return { x: i.x, y: -(i.y + i.d), w: i.s, h: i.d };
  if (direction === 'right') return { x: i.y, y: i.x, w: i.d, h: i.s };
  return { x: -(i.y + i.d), y: i.x, w: i.d, h: i.s };
}

function run(input: LayoutInput, o: TreeOptions): LayoutOutput {
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  if (nodes.length === 0) return { boxes: {} };
  const [nodeGap, rankGap] = GAPS[o.spacing];
  const c: Ctx = {
    forest: forestOf(nodes, input),
    byId: new Map(nodes.map((n) => [n.id, n])),
    gaps: { sibling: o.nodeGap ?? nodeGap, level: o.rankGap ?? rankGap, compactLeaves: o.compactLeaves },
    across: o.direction === 'right' || o.direction === 'left',
  };
  const items = pack(
    c.forest.roots.map((r) => subtree(r, c)),
    c.gaps.sibling,
  );
  const placed = new Map(items.map((i) => [i.id, toBox(i, o.direction)]));
  const loose = nodes.filter((n) => !n.pinned).map((n) => placed.get(n.id) as Box);
  const left = loose.length ? Math.min(...loose.map((b) => b.x)) : 0;
  const top = loose.length ? Math.min(...loose.map((b) => b.y)) : 0;
  // a Map, then fromEntries: a record id may be `__proto__`, which an assignment to a plain object would not keep as a key
  const boxes = new Map<string, Box>();
  for (const n of nodes) {
    const b = placed.get(n.id) as Box;
    boxes.set(n.id, n.pinned ? n.box : { x: b.x - left + input.frame.x + o.padding, y: b.y - top + input.frame.y + o.padding, w: b.w, h: b.h });
  }
  return { boxes: Object.fromEntries(boxes) };
}

/** A layout over `run` with the options of `schema`. */
function treeLike(id: string, describe: string, compactLeaves: boolean): LayoutAlgorithm<TreeOptions> {
  const schema = schemaWith(compactLeaves);
  return {
    id,
    describe,
    version: '1',
    schema,
    capabilities: { pins: true, compound: false, runsIn: 'either' },
    parseOptions(raw: unknown): OptionsResult<TreeOptions> {
      const r = schema.safeParse(raw);
      if (r.success) return { ok: true, value: r.data };
      const issue = r.error.issues[0];
      return { ok: false, message: `${id} options: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
    },
    run,
  };
}

/**
 * The `tree` layout: a tidy tree of variable-size boxes along the edges.
 *
 * @public
 */
export const treeLayout: LayoutAlgorithm<TreeOptions> = treeLike('tree', 'Tidy tree along the edges, for hierarchies with boxes of any size.', false);

/**
 * The `orgchart` layout: the tidy tree with leaf siblings stacked in one column under their parent.
 *
 * @public
 */
export const orgchartLayout: LayoutAlgorithm<TreeOptions> = treeLike(
  'orgchart',
  'Organisation chart: a tidy tree whose leaf siblings stack in one column under their manager.',
  true,
);
