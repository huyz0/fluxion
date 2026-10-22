// Nested containers, bottom-up (FR-LAY-005, 05-layout-and-routing.md §5): a node with children in the input is a container. Children are laid
// out first, deepest containers first; a container that nothing pins is then sized to its children plus an inset and enters its parent's layout
// as one box of that size, its children moving with it. A container that is pinned, or that holds a pinned node anywhere below it, is anchored:
// it keeps its own box (the document's placement), is a pinned node in its parent's layout, and its children are laid out inside that box
// (they can overflow it when it is too small: its box is not ours to grow). The runner lays out one level (algorithm, pins, overlap, snap).
import type { Box } from '@fluxion/geometry';
import type { Boxes } from './passes.js';
import type { LayoutEdge, LayoutInput, LayoutNode } from './types.js';

/**
 * Lays out one level: the children of `container` (or the roots when it is undefined), in the coordinates of `input.frame`.
 *
 * @public
 */
export type NestedRunner = (container: string | undefined, input: LayoutInput) => Boxes;

/**
 * Options of the nested layout.
 *
 * @public
 */
export type NestedOptions = {
  /** Space between a container's edge and its children when it is sized to them, px (default 16). */
  readonly inset?: number;
};

type Tree = {
  readonly byId: ReadonlyMap<string, LayoutNode>;
  readonly children: ReadonlyMap<string, readonly LayoutNode[]>;
  readonly roots: readonly LayoutNode[];
  readonly anchored: ReadonlySet<string>;
};

/** A solved subtree: the size of the node and the boxes of all its descendants relative to its top-left corner. */
type Solved = { readonly w: number; readonly h: number; readonly below: ReadonlyMap<string, Box> };

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const canonical = (a: LayoutNode, b: LayoutNode) => a.order - b.order || compare(a.id, b.id);

/** The parent of each node that has a usable one: present in the input, not itself, and not leading back to the node (a cycle has no parent). */
function parentsOf(nodes: readonly LayoutNode[]): Map<string, string> {
  const known = new Map(nodes.map((n) => [n.id, n] as const));
  const parent = new Map<string, string>();
  for (const n of [...nodes].sort(canonical)) {
    const p = n.parentId;
    if (p === undefined || p === n.id || !known.has(p)) continue;
    // walk up from p: reaching n means this link would close a cycle, so n stays a root
    let at: string | undefined = p;
    for (let steps = 0; at !== undefined && at !== n.id && steps <= nodes.length; steps += 1) at = parent.get(at);
    if (at === undefined) parent.set(n.id, p);
  }
  return parent;
}

/** The container tree of the input, and which nodes are anchored (pinned, or with a pinned node somewhere below). */
function treeOf(nodes: readonly LayoutNode[]): Tree {
  const parent = parentsOf(nodes);
  const kids = new Map<string, LayoutNode[]>();
  const roots: LayoutNode[] = [];
  for (const n of [...nodes].sort(canonical)) {
    const p = parent.get(n.id);
    if (p === undefined) roots.push(n);
    else kids.set(p, [...(kids.get(p) ?? []), n]);
  }
  const anchored = new Set<string>();
  for (const n of nodes) {
    if (!n.pinned) continue;
    for (let at: string | undefined = n.id; at !== undefined; at = parent.get(at)) anchored.add(at);
  }
  return { byId: new Map(nodes.map((n) => [n.id, n] as const)), children: kids, roots, anchored };
}

/** The edges whose two ends are both among `ids`. */
function edgesAmong(edges: readonly LayoutEdge[] | undefined, ids: ReadonlySet<string>): LayoutEdge[] {
  return (edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target));
}

/** The bounding box of `boxes`. */
function boundsOf(boxes: readonly Box[]): Box {
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  return { x: left, y: top, w: Math.max(...boxes.map((b) => b.x + b.w)) - left, h: Math.max(...boxes.map((b) => b.y + b.h)) - top };
}

type Ctx = { readonly tree: Tree; readonly input: LayoutInput; readonly run: NestedRunner; readonly inset: number; readonly solved: Map<string, Solved> };

/** `child` as a node of its parent's layout: sized by its solved subtree, anchored ones pinned on their own box (relative to `origin`). */
function asNode(ctx: Ctx, child: LayoutNode, origin: Box | undefined): LayoutNode {
  const sub = ctx.solved.get(child.id) as Solved;
  const anchored = ctx.tree.anchored.has(child.id);
  const at = origin ? { x: child.box.x - origin.x, y: child.box.y - origin.y } : { x: 0, y: 0 };
  return { ...child, box: { x: at.x, y: at.y, w: sub.w, h: sub.h }, ...(anchored ? { pinned: true } : {}) };
}

/** Solves the subtree of container `id`: its children first (already solved by the caller), then one level for its children. */
function solveContainer(ctx: Ctx, node: LayoutNode, kids: readonly LayoutNode[]): Solved {
  const anchored = ctx.tree.anchored.has(node.id);
  const nodes = kids.map((k) => asNode(ctx, k, anchored ? node.box : undefined));
  const frame = { x: 0, y: 0, w: node.box.w, h: node.box.h };
  const edges = edgesAmong(ctx.input.edges, new Set(kids.map((k) => k.id)));
  const placed = ctx.run(node.id, { frame, nodes, edges });
  const own = nodes.map((n) => placed[n.id] ?? n.box);
  // an anchored container keeps its box; any other is sized to its children and they are shifted to sit inside it
  const fit = anchored ? { x: 0, y: 0, w: node.box.w, h: node.box.h } : boundsOf(own);
  const [dx, dy] = anchored ? [0, 0] : [ctx.inset - fit.x, ctx.inset - fit.y];
  const below = new Map<string, Box>();
  for (const [i, k] of kids.entries()) {
    const box = own[i] as Box;
    const moved = { ...box, x: box.x + dx, y: box.y + dy };
    below.set(k.id, moved);
    for (const [id, inner] of ctx.solved.get(k.id)?.below ?? []) below.set(id, { ...inner, x: inner.x + moved.x, y: inner.y + moved.y });
  }
  return anchored ? { w: node.box.w, h: node.box.h, below } : { w: fit.w + 2 * ctx.inset, h: fit.h + 2 * ctx.inset, below };
}

/** Solves every node below `id` and then `id` itself, deepest first. */
function solve(ctx: Ctx, id: string): void {
  const node = ctx.tree.byId.get(id) as LayoutNode;
  const kids = ctx.tree.children.get(id) ?? [];
  for (const k of kids) solve(ctx, k.id);
  ctx.solved.set(id, kids.length === 0 ? { w: node.box.w, h: node.box.h, below: new Map() } : solveContainer(ctx, node, kids));
}

/**
 * Lay out nested containers bottom-up (FR-LAY-005). Returns the box of every node in the input, in the coordinates of `input.frame`.
 * A container that nothing pins is sized to its children plus `inset`; a pinned one, or one with a pinned node below it, keeps its box.
 * Pinned boxes are exact; a `parentId` that is missing, its own, or part of a cycle makes the node a root.
 *
 * @public
 */
export function layoutNested(input: LayoutInput, run: NestedRunner, options: NestedOptions = {}): Boxes {
  const tree = treeOf(input.nodes);
  const ctx: Ctx = { tree, input, run, inset: options.inset ?? 16, solved: new Map() };
  for (const r of tree.roots) solve(ctx, r.id);
  const roots = tree.roots.map((r) => asNode(ctx, r, undefined));
  // root boxes are absolute: an anchored root keeps its own box, so its position is its input position
  const levelNodes = roots.map((n) =>
    tree.anchored.has(n.id) ? { ...n, box: { ...n.box, x: (tree.byId.get(n.id) as LayoutNode).box.x, y: (tree.byId.get(n.id) as LayoutNode).box.y } } : n,
  );
  // an incremental run (ADR-0046) is incremental at the top level, where the boxes are the document's own; a container below is laid out afresh
  const incremental = input.previous ? { previous: input.previous, ...(input.changed ? { changed: input.changed } : {}) } : {};
  const placed = run(undefined, { frame: input.frame, nodes: levelNodes, edges: edgesAmong(input.edges, new Set(roots.map((r) => r.id))), ...incremental });
  const out = new Map<string, Box>();
  for (const n of levelNodes) {
    const box = placed[n.id] ?? n.box;
    out.set(n.id, box);
    for (const [id, inner] of ctx.solved.get(n.id)?.below ?? []) out.set(id, { ...inner, x: inner.x + box.x, y: inner.y + box.y });
  }
  return Object.fromEntries(out);
}
