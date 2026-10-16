// The layout scorecard (FR-LAY-001, FR-LAY-004): how good a set of boxes is for the edges between them. Edges are scored as the straight
// segments between box centres, the route a connector takes before the router bends it, so the counts depend only on the boxes and are pure.
import type { Box } from '@fluxion/geometry';
import { overlapCount } from './overlap.js';
import type { Boxes } from './passes.js';
import type { LayoutEdge, LayoutInput } from './types.js';

/**
 * The scorecard of a layout: lower is better in every column.
 *
 * @public
 */
export type Scorecard = {
  /** Pairs of boxes that overlap. */
  readonly overlaps: number;
  /** Pairs of edges that cross (edges that share a node do not count). */
  readonly crossings: number;
  /** Edges that are neither horizontal nor vertical, each needing at least one bend in an orthogonal route. */
  readonly bends: number;
  /** The mean distance (px, rounded) the boxes moved from where the input had them. */
  readonly displacement: number;
};

type Point = readonly [number, number];
type Segment = { readonly edge: LayoutEdge; readonly from: Point; readonly to: Point };

/** Differences smaller than this are rounding, not geometry. */
const EPSILON = 1e-6;

const centre = (b: Box): Point => [b.x + b.w / 2, b.y + b.h / 2];

/** The side of the line `a`-`b` that `p` is on: 1, -1, or 0 when on it. */
function side(a: Point, b: Point, p: Point): number {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  return Math.abs(cross) < EPSILON ? 0 : Math.sign(cross);
}

/** Whether two segments cross at a point inside both (touching ends do not count). */
function crosses(s: Segment, t: Segment): boolean {
  return side(s.from, s.to, t.from) * side(s.from, s.to, t.to) < 0 && side(t.from, t.to, s.from) * side(t.from, t.to, s.to) < 0;
}

/** The segment of every edge whose two ends have a box and differ. */
function segmentsOf(edges: readonly LayoutEdge[], boxes: Boxes): Segment[] {
  const out: Segment[] = [];
  for (const edge of edges) {
    const [a, b] = [boxes[edge.source], boxes[edge.target]];
    if (a && b && edge.source !== edge.target) out.push({ edge, from: centre(a), to: centre(b) });
  }
  return out;
}

const shareNode = (s: Segment, t: Segment) =>
  s.edge.source === t.edge.source || s.edge.source === t.edge.target || s.edge.target === t.edge.source || s.edge.target === t.edge.target;

/** The pairs of edges that cross. */
export function crossingCount(edges: readonly LayoutEdge[], boxes: Boxes): number {
  const segments = segmentsOf(edges, boxes);
  let count = 0;
  for (const [i, s] of segments.entries()) for (const t of segments.slice(i + 1)) if (!shareNode(s, t) && crosses(s, t)) count += 1;
  return count;
}

/** The edges that are neither horizontal nor vertical. */
export function bendCount(edges: readonly LayoutEdge[], boxes: Boxes): number {
  return segmentsOf(edges, boxes).filter(({ from, to }) => Math.abs(from[0] - to[0]) > EPSILON && Math.abs(from[1] - to[1]) > EPSILON).length;
}

/** The mean distance the box centres moved from the input, rounded to whole px. */
export function displacementOf(input: LayoutInput, boxes: Boxes): number {
  const moved = input.nodes.flatMap((n) => {
    const after = boxes[n.id];
    if (!after) return [];
    const [a, b] = [centre(n.box), centre(after)];
    return [Math.hypot(a[0] - b[0], a[1] - b[1])];
  });
  return moved.length === 0 ? 0 : Math.round(moved.reduce((sum, d) => sum + d, 0) / moved.length);
}

/**
 * Score `boxes` as a layout of `input`.
 *
 * @public
 */
export function scoreLayout(input: LayoutInput, boxes: Boxes): Scorecard {
  const edges = input.edges ?? [];
  return { overlaps: overlapCount(boxes), crossings: crossingCount(edges, boxes), bends: bendCount(edges, boxes), displacement: displacementOf(input, boxes) };
}
