// Line jumps (FR-CON-008): where two connectors cross, the one later in z-order hops over the other,
// drawing an arc or leaving a gap. Crossings come from geometry's sweep; the list is cached while no
// route's revision changes. Pure: it turns points into path commands, the renderer draws them.
import { type PathCommand, polylineCrossings, type Vec2 } from '@fluxion/geometry';

/**
 * How a connector draws where it crosses another: an arc over it, a gap in the line, or straight on.
 *
 * @public
 */
export type JumpStyle = 'arc' | 'gap' | 'none';

/**
 * A connector's route as the jumps need it.
 *
 * @public
 */
export type JumpRoute = {
  /** The connector's id. */
  readonly id: string;
  /** Stacking order; the higher of two crossing connectors hops (ties: the later id). */
  readonly z: number;
  /** Changes whenever the route does; the cache key. */
  readonly revision: string;
  /** The route's corner points. */
  readonly points: readonly Vec2[];
  /** Overrides the document's style for this connector. */
  readonly style?: JumpStyle | undefined;
};

/**
 * A crossing a connector hops over.
 *
 * @public
 */
export type Jump = {
  /** Where the other connector crosses. */
  readonly at: Vec2;
  /** Index of the segment of the hopping connector the crossing lies on. */
  readonly segment: number;
};

/**
 * The hops of each connector that has any, by connector id.
 *
 * @public
 */
export type JumpMap = ReadonlyMap<string, readonly Jump[]>;

const above = (u: JumpRoute, v: JumpRoute): boolean => u.z > v.z || (u.z === v.z && u.id > v.id);

/**
 * The jumps of every connector: each crossing belongs to the later one, unless its style is `none`.
 *
 * @public
 */
export function findJumps(routes: readonly JumpRoute[], documentStyle: JumpStyle = 'arc'): JumpMap {
  const byId = new Map(routes.map((r) => [r.id, r]));
  const out = new Map<string, Jump[]>();
  for (const c of polylineCrossings(routes.map((r) => ({ id: r.id, points: r.points })))) {
    const [ra, rb] = [byId.get(c.a) as JumpRoute, byId.get(c.b) as JumpRoute];
    const [top, segment] = above(ra, rb) ? [ra, c.aSegment] : [rb, c.bSegment];
    if ((top.style ?? documentStyle) === 'none') continue;
    out.set(top.id, [...(out.get(top.id) ?? []), { at: c.at, segment }]);
  }
  return out;
}

/**
 * A cache of {@link findJumps}: asked again with the same routes (ids, z, revisions, styles) and
 * document style, it returns the same map without finding the crossings again.
 *
 * @public
 */
export function createJumpCache(): (routes: readonly JumpRoute[], documentStyle?: JumpStyle) => JumpMap {
  let key: string | undefined;
  let last: JumpMap = new Map();
  return (routes, documentStyle = 'arc') => {
    const next = `${documentStyle}|${routes.map((r) => `${r.id}:${r.z}:${r.revision}:${r.style ?? ''}`).join(',')}`;
    if (next !== key) {
      last = findJumps(routes, documentStyle);
      key = next;
    }
    return last;
  };
}

const distanceTo = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The unit normal of `dir` that points up the screen (right when `dir` is vertical), so a hop reads the same either way along the line. */
function upNormal(dir: Vec2): Vec2 {
  const n = { x: dir.y, y: -dir.x };
  return n.y < 0 || (n.y === 0 && n.x > 0) ? n : { x: -n.x, y: -n.y };
}

/** The hops of one segment `p`-`q` that fit: sorted along it, clear of both ends and of each other by their width. */
function fitting(p: Vec2, q: Vec2, jumps: readonly Jump[], radius: number): Vec2[] {
  const length = distanceTo(p, q);
  const sorted = jumps.map((j) => j.at).sort((u, v) => distanceTo(p, u) - distanceTo(p, v));
  const kept: Vec2[] = [];
  for (const at of sorted) {
    const d = distanceTo(p, at);
    const previous = kept.at(-1);
    if (d >= radius && length - d >= radius && (previous === undefined || distanceTo(previous, at) >= 2 * radius)) kept.push(at);
  }
  return kept;
}

/** The commands for one hop over `at` along the unit direction `dir`. */
function hop(at: Vec2, dir: Vec2, radius: number, style: 'arc' | 'gap'): PathCommand[] {
  const a = { x: at.x - dir.x * radius, y: at.y - dir.y * radius };
  const b = { x: at.x + dir.x * radius, y: at.y + dir.y * radius };
  if (style === 'gap')
    return [
      { kind: 'L', to: a },
      { kind: 'M', to: b },
    ];
  // a cubic through a, b with controls 4r/3 up: its crest is r above the line
  const n = upNormal(dir);
  const h = (4 / 3) * radius;
  return [
    { kind: 'L', to: a },
    { kind: 'C', control1: { x: a.x + n.x * h, y: a.y + n.y * h }, control2: { x: b.x + n.x * h, y: b.y + n.y * h }, to: b },
  ];
}

/**
 * The path through `points` with a hop of half-width `radius` at each of `jumps` that fits (clear of
 * a corner and of the previous hop). A `gap` hop starts a new subpath after the gap.
 *
 * @public
 */
export function hopPath(points: readonly Vec2[], jumps: readonly Jump[], style: 'arc' | 'gap' = 'arc', radius = 6): PathCommand[] {
  const first = points[0];
  if (first === undefined) return [];
  const out: PathCommand[] = [{ kind: 'M', to: first }];
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1] as Vec2, points[i] as Vec2];
    const length = distanceTo(p, q);
    const dir = length > 0 ? { x: (q.x - p.x) / length, y: (q.y - p.y) / length } : { x: 0, y: 0 };
    for (const at of fitting(
      p,
      q,
      jumps.filter((j) => j.segment === i - 1),
      radius,
    ))
      out.push(...hop(at, dir, radius, style));
    out.push({ kind: 'L', to: q });
  }
  return out;
}
