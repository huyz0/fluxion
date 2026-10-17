// Auto anchors (ADR-0043, FR-ANC-004): which side of each end element a connector leaves and enters by. A pure function of the boxes, the
// weights of architecture 05 §8 and the previous choice: every (source side, target side) pair costs its length, bends, a push for
// leaving away from the other end, crowding of the side, a role mismatch and, for any end that changes side, a hysteresis share of the
// best cost, so a side changes only when another is clearly better. An algorithm-assigned side earns a strong bonus.
import type { Box, Vec2 } from '@fluxion/geometry';

/**
 * A side of a box.
 *
 * @public
 */
export type Side = 'n' | 'e' | 's' | 'w';

/**
 * The weights of the pair cost, tunable by the router options.
 *
 * @public
 */
export type AutoWeights = {
  /** Per px of manhattan distance between the two anchor points. */
  readonly length: number;
  /** Per bend of the elbow route. */
  readonly bend: number;
  /** Per end that leaves pointing away from the other end. */
  readonly away: number;
  /** Per connector already on the side of that element. */
  readonly crowding: number;
  /** Per end on a side its roles do not allow. */
  readonly role: number;
  /** Taken off for an end on its algorithm-assigned side. */
  readonly assigned: number;
  /** Share of the best cost added to every candidate that changes an end's previous side. */
  readonly hysteresis: number;
};

/**
 * The defaults of 05-layout-and-routing.md §8.
 *
 * @public
 */
export const AUTO_WEIGHTS: AutoWeights = { length: 1, bend: 40, away: 80, crowding: 25, role: 30, assigned: 200, hysteresis: 0.15 };

/**
 * One end of an auto connector.
 *
 * @public
 */
export type AutoEnd = {
  /** The element, so connectors on its sides are counted together. */
  readonly key: string;
  /** Its box on screen. */
  readonly box: Box;
  /** The sides its anchor roles allow; any when absent. */
  readonly roleSides?: readonly Side[] | undefined;
  /** A side the layout algorithm assigned. */
  readonly assigned?: Side | undefined;
  /** The side chosen last time, for hysteresis. */
  readonly previous?: Side | undefined;
};

/**
 * A connector to give sides to.
 *
 * @public
 */
export type AutoEdge = {
  /** The source end. */
  readonly source: AutoEnd;
  /** The target end. */
  readonly target: AutoEnd;
};

/**
 * The sides chosen for one connector.
 *
 * @public
 */
export type AutoChoice = {
  /** Side of the source. */
  readonly source: Side;
  /** Side of the target. */
  readonly target: Side;
};

/**
 * Options of the selection.
 *
 * @public
 */
export type AutoOptions = {
  /** Weights; the defaults of {@link AUTO_WEIGHTS} when absent. */
  readonly weights?: Partial<AutoWeights> | undefined;
  /** During a drag the previous choice is kept; it is scored again on drop. */
  readonly frozen?: boolean | undefined;
};

const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
const OUT: Readonly<Record<Side, Vec2>> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };

/** The midpoint of a side. */
function midpoint(b: Box, s: Side): Vec2 {
  if (s === 'n') return { x: b.x + b.w / 2, y: b.y };
  if (s === 's') return { x: b.x + b.w / 2, y: b.y + b.h };
  return s === 'e' ? { x: b.x + b.w, y: b.y + b.h / 2 } : { x: b.x, y: b.y + b.h / 2 };
}

const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

/** Bends of the elbow route that leaves along `d1` from `p1` and enters against `d2` at `p2`. */
function bends(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): number {
  const delta = { x: p2.x - p1.x, y: p2.y - p1.y };
  const facing = dot(d1, d2);
  if (facing === 0) return dot(d1, delta) > 0 && dot(d2, delta) < 0 ? 1 : 3;
  if (facing < 0) return Math.abs(d1.x * delta.y - d1.y * delta.x) < 1e-6 ? 0 : 2;
  return 2;
}

type Ctx = { readonly w: AutoWeights; readonly load: (key: string, s: Side) => number };

/** The part of an end's cost that depends on the side alone: crowding, role mismatch and the assigned-side bonus. */
function endCost(e: AutoEnd, s: Side, c: Ctx): number {
  const mismatch = e.roleSides && !e.roleSides.includes(s) ? c.w.role : 0;
  return c.w.crowding * c.load(e.key, s) + mismatch - (e.assigned === s ? c.w.assigned : 0);
}

/** The cost of the pair of sides, before hysteresis. */
function pairCost(edge: AutoEdge, sides: { readonly s: Side; readonly t: Side }, c: Ctx): number {
  const [pa, pb] = [midpoint(edge.source.box, sides.s), midpoint(edge.target.box, sides.t)];
  const [da, db] = [OUT[sides.s], OUT[sides.t]];
  const toB = { x: pb.x - pa.x, y: pb.y - pa.y };
  const away = (dot(da, toB) < 0 ? 1 : 0) + (dot(db, toB) > 0 ? 1 : 0);
  const reach = c.w.length * (Math.abs(toB.x) + Math.abs(toB.y)) + c.w.bend * bends(pa, da, pb, db) + c.w.away * away;
  return reach + endCost(edge.source, sides.s, c) + endCost(edge.target, sides.t, c);
}

/** The pair with the least cost once hysteresis is added; ties go to the first in n, e, s, w order. */
function best(edge: AutoEdge, c: Ctx): AutoChoice {
  const pairs = SIDES.flatMap((s) => SIDES.map((t) => ({ s, t, cost: pairCost(edge, { s, t }, c) })));
  const floor = Math.min(...pairs.map((p) => p.cost));
  const h = c.w.hysteresis * Math.abs(floor);
  let pick = pairs[0] as (typeof pairs)[number];
  let pickCost = Number.POSITIVE_INFINITY;
  for (const p of pairs) {
    const c =
      p.cost +
      (edge.source.previous !== undefined && p.s !== edge.source.previous ? h : 0) +
      (edge.target.previous !== undefined && p.t !== edge.target.previous ? h : 0);
    if (c < pickCost - 1e-9) [pick, pickCost] = [p, c];
  }
  return { source: pick.s, target: pick.t };
}

/**
 * The sides for each connector, in order: each choice counts toward the crowding of the next. A frozen choice keeps the previous sides.
 *
 * @public
 */
export function chooseAutoSides(edges: readonly AutoEdge[], options: AutoOptions = {}): AutoChoice[] {
  const w: AutoWeights = { ...AUTO_WEIGHTS, ...options.weights };
  const counts = new Map<string, number>();
  const load = (key: string, s: Side): number => counts.get(`${key}:${s}`) ?? 0;
  const bump = (key: string, s: Side): void => void counts.set(`${key}:${s}`, load(key, s) + 1);
  return edges.map((edge) => {
    const frozen = options.frozen && edge.source.previous !== undefined && edge.target.previous !== undefined;
    const choice = frozen ? { source: edge.source.previous as Side, target: edge.target.previous as Side } : best(edge, { w, load });
    bump(edge.source.key, choice.source);
    bump(edge.target.key, choice.target);
    return choice;
  });
}
