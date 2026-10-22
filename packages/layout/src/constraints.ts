// The `constraints` post-pass (FR-LAY-006, ADR-0045): a projection of the algorithm's boxes onto the input's constraints, run after `pins`
// and before `overlap`. In order: `align` and `sameRank` move each group onto one coordinate (a pinned or already aligned member's, else the
// lower median of the members'; groups sharing a node on one axis and point merge first), `order` pushes the later box past the earlier one, and `spacing` sweeps each axis and moves a box toward or
// away from its neighbour. A node never moves along an axis on which it is pinned or aligned, so a later step cannot undo an alignment; a
// group with two fixed members at different places (two pins, or a node aligned on one axis at two points) keeps the first (canonical order). Everything is in a fixed order with no randomness, so
// the result is deterministic. Sizes never change.
import type { Box } from '@fluxion/geometry';
import type { Boxes } from './passes.js';
import type { LayoutConstraint, LayoutInput } from './types.js';

type Axis = 'x' | 'y';
type At = 'start' | 'center' | 'end';
type Fixed = Readonly<Record<Axis, Set<string>>>;

/** A gap or overlap shorter than this is rounding noise. */
const EPSILON = 1e-9;
const AXES: readonly Axis[] = ['x', 'y'];
const other = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');
const startOf = (b: Box, axis: Axis): number => (axis === 'x' ? b.x : b.y);
const sizeOf = (b: Box, axis: Axis): number => (axis === 'x' ? b.w : b.h);
const endOf = (b: Box, axis: Axis): number => startOf(b, axis) + sizeOf(b, axis);
const offset = (b: Box, axis: Axis, at: At): number => (at === 'start' ? 0 : at === 'center' ? sizeOf(b, axis) / 2 : sizeOf(b, axis));
const moved = (b: Box, axis: Axis, by: number): Box => (axis === 'x' ? { ...b, x: b.x + by } : { ...b, y: b.y + by });

/** The group of an `align` or `sameRank` constraint (axis, anchor point), or undefined for the other types. */
function groupOf(c: LayoutConstraint): { readonly axis: Axis; readonly at: At; readonly nodes: readonly string[] } | undefined {
  if (c.type === 'align') return { axis: c.axis, at: c.at ?? 'center', nodes: c.nodes };
  if (c.type === 'sameRank') return { axis: c.axis ?? 'y', at: 'center', nodes: c.nodes };
  return undefined;
}

/**
 * The axes each node may not move along because an `align` or `sameRank` constraint with two or more nodes of the input holds it there. The
 * overlap pass reads this so that it never undoes an alignment.
 */
export function alignedAxes(input: LayoutInput): ReadonlyMap<string, ReadonlySet<'x' | 'y'>> {
  const known = new Set(input.nodes.map((n) => n.id));
  const out = new Map<string, Set<Axis>>();
  for (const c of input.constraints ?? []) {
    const group = groupOf(c);
    const members = group ? [...new Set(group.nodes)].filter((id) => known.has(id)) : [];
    if (!group || members.length < 2) continue;
    for (const id of members) out.set(id, (out.get(id) ?? new Set<Axis>()).add(group.axis));
  }
  return out;
}

/** Why the constraints cannot be applied, or undefined: an unknown type, a number that is not finite or is negative, `min` above `max`. */
export function constraintProblem(constraints: readonly LayoutConstraint[]): string | undefined {
  for (const [i, c] of constraints.entries()) {
    const problem = problemOf(c);
    if (problem) return `constraint ${i} ${problem}`;
  }
  return undefined;
}

const badLength = (n: number | undefined): boolean => n !== undefined && !(Number.isFinite(n) && n >= 0);

const isAxis = (a: unknown): boolean => a === 'x' || a === 'y';
const isIds = (ids: unknown): boolean => Array.isArray(ids) && ids.every((id) => typeof id === 'string');

/** Why a group constraint cannot be read (review M17.8 F1: a bad axis or anchor point must be refused, not crash the pass). */
function groupProblem(c: Extract<LayoutConstraint, { type: 'align' | 'sameRank' }>): string | undefined {
  if (!isIds(c.nodes)) return 'has no list of node ids';
  if (c.type === 'sameRank') return c.axis === undefined || isAxis(c.axis) ? undefined : 'has an axis that is not x or y';
  if (!isAxis(c.axis)) return 'has an axis that is not x or y';
  return c.at === undefined || ['start', 'center', 'end'].includes(c.at) ? undefined : 'has an anchor point that is not start, center or end';
}

function orderProblem(c: Extract<LayoutConstraint, { type: 'order' }>): string | undefined {
  if (!isAxis(c.axis)) return 'has an axis that is not x or y';
  if (typeof c.before !== 'string' || typeof c.after !== 'string') return 'has a before or after that is not a node id';
  return badLength(c.gap) ? 'has a gap that is not a finite number of 0 or more' : undefined;
}

function problemOf(c: LayoutConstraint): string | undefined {
  if (typeof c !== 'object' || c === null) return 'is not an object';
  switch (c.type) {
    case 'align':
    case 'sameRank':
      return groupProblem(c);
    case 'order':
      return orderProblem(c);
    case 'spacing':
      if (badLength(c.min) || badLength(c.max)) return 'has a min or max that is not a finite number of 0 or more';
      return c.min !== undefined && c.max !== undefined && c.min > c.max ? 'has a min above its max' : undefined;
    default:
      return `has the unknown type "${String((c as { type?: unknown }).type)}"`;
  }
}

/** The state of one run of the pass: the boxes being moved, the canonical rank of each node, and what may not move along each axis. */
type Work = { readonly boxes: Map<string, Box>; readonly rank: ReadonlyMap<string, number>; readonly fixed: Fixed };

type Merging = { readonly axis: Axis; readonly at: At; readonly nodes: Set<string> };

/** Move the nodes of each of `others` into `into` and drop them from `merged`. */
function absorb(merged: Merging[], into: Merging, others: readonly Merging[]): void {
  for (const m of others) {
    for (const id of m.nodes) into.nodes.add(id);
    merged.splice(merged.indexOf(m), 1);
  }
}

type Group = { readonly axis: Axis; readonly at: At; readonly nodes: readonly string[] };

/**
 * The `align` and `sameRank` groups, those that share a node on the same axis and anchor point merged into one (review M17.8 F2): `{a,b}`,
 * `{c,d}` and `{b,c}` are one line, not three. Merged groups keep the place of their first member group.
 */
function mergedGroups(constraints: readonly LayoutConstraint[]): Group[] {
  const merged: Merging[] = [];
  for (const c of constraints) {
    const group = groupOf(c);
    if (!group) continue;
    const joins = merged.filter((m) => m.axis === group.axis && m.at === group.at && group.nodes.some((id) => m.nodes.has(id)));
    const into = joins[0] ?? { axis: group.axis, at: group.at, nodes: new Set<string>() };
    if (joins.length === 0) merged.push(into);
    for (const id of group.nodes) into.nodes.add(id);
    absorb(merged, into, joins.slice(1));
  }
  return merged.map((m) => ({ axis: m.axis, at: m.at, nodes: [...m.nodes] }));
}

/** Move the members of one group onto one coordinate, then fix them on that axis. */
function align(work: Work, group: Group): void {
  const { axis, at } = group;
  const members = [...new Set(group.nodes)].filter((id) => work.boxes.has(id)).sort((a, b) => (work.rank.get(a) ?? 0) - (work.rank.get(b) ?? 0));
  if (members.length < 2) return;
  const point = (id: string) => {
    const b = work.boxes.get(id) as Box;
    return startOf(b, axis) + offset(b, axis, at);
  };
  const anchor = members.find((id) => work.fixed[axis].has(id));
  const values = members.map(point).sort((a, b) => a - b);
  const target = anchor === undefined ? (values[Math.floor((values.length - 1) / 2)] as number) : point(anchor);
  for (const id of members) {
    if (!work.fixed[axis].has(id)) work.boxes.set(id, moved(work.boxes.get(id) as Box, axis, target - point(id)));
    work.fixed[axis].add(id);
  }
}

/** Push `after` past `before` (or, when `after` may not move, `before` back). Returns whether a box moved. */
function order(work: Work, c: Extract<LayoutConstraint, { type: 'order' }>): boolean {
  const [a, b] = [work.boxes.get(c.before), work.boxes.get(c.after)];
  if (!a || !b || c.before === c.after) return false;
  const need = endOf(a, c.axis) + (c.gap ?? 0) - startOf(b, c.axis);
  if (need <= EPSILON) return false;
  const fixed = work.fixed[c.axis];
  if (!fixed.has(c.after)) work.boxes.set(c.after, moved(b, c.axis, need));
  else if (!fixed.has(c.before)) work.boxes.set(c.before, moved(a, c.axis, -need));
  else return false;
  return true;
}

/** True when the spans of `a` and `b` across `axis` overlap: they are in one row (or column) along it. */
const inLine = (a: Box, b: Box, axis: Axis): boolean =>
  Math.min(endOf(a, other(axis)), endOf(b, other(axis))) - Math.max(startOf(a, other(axis)), startOf(b, other(axis))) > EPSILON;

/** The end of the furthest box before `id` in its row along `axis`, among `done`, or undefined when it has none. */
function neighbourEnd(work: Work, id: string, done: readonly string[], axis: Axis): number | undefined {
  const box = work.boxes.get(id) as Box;
  let end: number | undefined;
  for (const d of done) {
    const b = work.boxes.get(d) as Box;
    if (inLine(box, b, axis)) end = Math.max(end ?? Number.NEGATIVE_INFINITY, endOf(b, axis));
  }
  return end;
}

/** The move that brings a gap within [min, max] (0 when it is). */
function correction(gap: number, c: Extract<LayoutConstraint, { type: 'spacing' }>): number {
  if (c.min !== undefined && gap < c.min - EPSILON) return c.min - gap;
  if (c.max !== undefined && gap > c.max + EPSILON) return c.max - gap;
  return 0;
}

/** One sweep along `axis`: boxes by start, each moved so that the gap to its row's previous box is within [min, max]. */
function sweep(work: Work, c: Extract<LayoutConstraint, { type: 'spacing' }>, axis: Axis): void {
  const ids = [...work.boxes.keys()].sort(
    (a, b) => startOf(work.boxes.get(a) as Box, axis) - startOf(work.boxes.get(b) as Box, axis) || (work.rank.get(a) ?? 0) - (work.rank.get(b) ?? 0),
  );
  const done: string[] = [];
  for (const id of ids) {
    const end = neighbourEnd(work, id, done, axis);
    const box = work.boxes.get(id) as Box;
    const by = end === undefined || work.fixed[axis].has(id) ? 0 : correction(startOf(box, axis) - end, c);
    if (by !== 0) work.boxes.set(id, moved(box, axis, by));
    done.push(id);
  }
}

/**
 * Apply the input's constraints to `boxes` (FR-LAY-006): pinned boxes never move, the members of each `align` or `sameRank` group end on one
 * coordinate, then `order` and `spacing` move only what they may. Ids in `boxes` that are not in the input are ignored.
 *
 * @public
 */
export function applyConstraints(input: LayoutInput, boxes: Boxes): Boxes {
  const constraints = input.constraints ?? [];
  if (constraints.length === 0) return boxes;
  const work = workOf(input, boxes);
  for (const group of mergedGroups(constraints)) align(work, group);
  orderAll(
    work,
    constraints.filter((c): c is Extract<LayoutConstraint, { type: 'order' }> => c.type === 'order'),
  );
  for (const c of constraints) if (c.type === 'spacing') for (const axis of AXES) sweep(work, c, axis);
  return Object.fromEntries(work.boxes);
}

/** The work of one run: the input's nodes that have a box, in canonical order, pinned ones fixed on both axes. */
function workOf(input: LayoutInput, boxes: Boxes): Work {
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).filter((n) => Object.hasOwn(boxes, n.id));
  const pinned = nodes.filter((n) => n.pinned).map((n) => n.id);
  return {
    boxes: new Map(nodes.map((n) => [n.id, boxes[n.id] as Box] as const)),
    rank: new Map(nodes.map((n, i) => [n.id, i] as const)),
    fixed: { x: new Set(pinned), y: new Set(pinned) },
  };
}

/** Every `order` constraint, in passes until none moves a box: a chain listed backwards needs one pass per link; a cycle stops at the cap. */
function orderAll(work: Work, orders: readonly Extract<LayoutConstraint, { type: 'order' }>[]): void {
  for (let pass = 0; pass <= orders.length; pass += 1) if (!orders.map((c) => order(work, c)).includes(true)) return;
}
