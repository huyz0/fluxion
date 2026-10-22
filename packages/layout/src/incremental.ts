// Incremental mode (FR-LAY-006, ADR-0046): when an input carries `previous`, the pipeline keeps the diagram where it was. An algorithm that
// warm-starts itself (`capabilities.incremental`, today `force`) is left alone; any other runs fully and is then reconciled: each connected
// component (by the input's edges; the nodes without an edge count as one) is translated by the median offset of its unchanged nodes from
// their previous boxes, and a component with no unchanged node by the median offset over all of them. A node is unchanged when it is in
// `previous` and not in `changed`; pinned nodes are not counted and are put back by the `pins` pass. The `moved` metric counts the nodes
// whose centre moved by more than 0.5 px.
import type { Box } from '@fluxion/geometry';
import type { Boxes } from './passes.js';
import type { LayoutInput } from './types.js';

/** A centre that moved by no more than this has not moved (the half-pixel grid of `snap`). */
const STILL = 0.5;

const centre = (b: Box): readonly [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
/** The lower median of `values` (0 for none). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.floor((sorted.length - 1) / 2)] as number);
}

/**
 * The connected components of the ids, by the input's edges, each in the order of `ids`. The nodes without an edge form one group: their
 * arrangement is the algorithm's (a packing, a grid), so they move together rather than each back to its own previous box.
 */
function componentsOf(ids: readonly string[], input: LayoutInput): string[][] {
  const parent = new Map(ids.map((id) => [id, id] as const));
  const root = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    return r;
  };
  const linked = new Set<string>();
  for (const e of input.edges ?? []) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue;
    linked.add(e.source).add(e.target);
    parent.set(root(e.source), root(e.target));
  }
  const loose = ids.filter((id) => !linked.has(id));
  for (const id of loose.slice(1)) parent.set(root(id), root(loose[0] as string));
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const group = groups.get(root(id));
    if (group) group.push(id);
    else groups.set(root(id), [id]);
  }
  return [...groups.values()];
}

/** The ids whose previous place should hold: in `previous`, in `boxes`, not changed and not pinned. */
function unchangedIds(input: LayoutInput, boxes: Boxes): Set<string> {
  const previous = input.previous ?? {};
  const changed = new Set(input.changed ?? []);
  return new Set(input.nodes.filter((n) => !n.pinned && !changed.has(n.id) && Object.hasOwn(previous, n.id) && Object.hasOwn(boxes, n.id)).map((n) => n.id));
}

/** The median offset (previous minus now) of the centres of `ids`. */
function offsetOf(ids: readonly string[], previous: Boxes, boxes: Boxes): readonly [number, number] {
  const deltas = ids.map((id) => {
    const [[px, py], [nx, ny]] = [centre(previous[id] as Box), centre(boxes[id] as Box)];
    return [px - nx, py - ny] as const;
  });
  return [median(deltas.map((d) => d[0])), median(deltas.map((d) => d[1]))];
}

/**
 * Translate a full run's result so that the unchanged nodes stay where `previous` had them, component by component (ADR-0046). Without
 * `previous` the boxes are returned as they are.
 *
 * @public
 */
export function reconcile(input: LayoutInput, boxes: Boxes): Boxes {
  const previous = input.previous;
  if (!previous) return boxes;
  const order = [...input.nodes].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = order.map((n) => n.id).filter((id) => Object.hasOwn(boxes, id));
  const unchanged = unchangedIds(input, boxes);
  if (unchanged.size === 0) return boxes;
  const overall = offsetOf([...unchanged], previous, boxes);
  const out: Record<string, Box> = { ...boxes };
  for (const component of componentsOf(ids, input)) {
    const anchors = component.filter((id) => unchanged.has(id));
    const [dx, dy] = anchors.length ? offsetOf(anchors, previous, boxes) : overall;
    for (const id of component) {
      const b = boxes[id] as Box;
      out[id] = { ...b, x: b.x + dx, y: b.y + dy };
    }
  }
  return out;
}

/**
 * The share of the nodes in both `previous` and `boxes` whose centre moved by more than 0.5 px, in percent (0 when none are in both).
 *
 * @public
 */
export function movedPercent(previous: Boxes, boxes: Boxes): number {
  const both = Object.keys(boxes).filter((id) => Object.hasOwn(previous, id));
  if (both.length === 0) return 0;
  const moved = both.filter((id) => {
    const [[px, py], [nx, ny]] = [centre(previous[id] as Box), centre(boxes[id] as Box)];
    return Math.abs(px - nx) > STILL || Math.abs(py - ny) > STILL;
  });
  return (moved.length / both.length) * 100;
}
