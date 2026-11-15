// Ring arithmetic for the boolean operations (ADR-0053): signed area, containment, splitting a self-crossing ring into simple
// loops, and an operand's filled region as even-odd polygons (step 3). A nonzero operand's rings are nested by containment and
// each gets the winding just inside it, w(R) = w(parent) + sign(R); its region is the union of every R with w(R) ≠ 0 minus R's
// children. Pure: products and sums only.
import type { Vec2 } from '../vec2.js';

/** A closed ring of points (its last point joins its first). */
export type Ring = readonly Vec2[];

/** Twice the signed area of `r` (shoelace, y down: positive is clockwise on screen). */
export function area2(r: Ring): number {
  let sum = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i] as Vec2;
    const b = r[(i + 1) % r.length] as Vec2;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Whether `p` is inside `r` by crossings (the even-odd test of one ring). */
export function inRing(r: Ring, p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i] as Vec2;
    const b = r[j] as Vec2;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A point of `r` well inside it if it is simple: the centroid of the triangle at its first convex corner, else its first point. */
function probe(r: Ring): Vec2 {
  const sign = Math.sign(area2(r));
  for (let i = 0; i < r.length; i++) {
    const [a, b, c] = [r[(i + r.length - 1) % r.length], r[i], r[(i + 1) % r.length]] as [Vec2, Vec2, Vec2];
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const mid = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
    if (Math.sign(turn) === sign && inRing(r, mid)) return mid;
  }
  return r[0] as Vec2;
}

/** Where segments a→b and c→d properly cross: the parameters along each, or undefined. */
function crossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): readonly [number, number] | undefined {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (den === 0) return undefined;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? [t, u] : undefined;
}

type Mark = { readonly t: number; readonly id: number; readonly at: Vec2 };
/** A point of the walk along a ring: a crossing carries its id. */
type Visit = { readonly p: Vec2; readonly id?: number };

/** Every proper crossing of `r` with itself, as marks on each edge it falls on (sorted along the edge). */
function selfCrossings(r: Ring): Mark[][] {
  const marks: Mark[][] = r.map(() => []);
  let id = 0;
  for (let i = 0; i < r.length; i++) {
    for (let j = i + 2; j < r.length; j++) {
      // the closing edge meets the first at their shared point
      if (i === 0 && j === r.length - 1) continue;
      const [a, b, c, d] = [r[i], r[(i + 1) % r.length], r[j], r[(j + 1) % r.length]] as [Vec2, Vec2, Vec2, Vec2];
      const hit = crossing(a, b, c, d);
      if (hit === undefined) continue;
      const at = { x: a.x + (b.x - a.x) * hit[0], y: a.y + (b.y - a.y) * hit[0] };
      (marks[i] as Mark[]).push({ t: hit[0], id, at });
      (marks[j] as Mark[]).push({ t: hit[1], id, at });
      id++;
    }
  }
  for (const m of marks) m.sort((p, q) => p.t - q.t);
  return marks;
}

/**
 * The loop from the crossing first visited at `stack[back]` back to it, taken off `stack` (the crossing stays as the walk's next
 * point) with the crossings it held forgotten.
 */
function closeLoop(stack: Visit[], seen: Map<number, number>, back: number): Ring {
  const loop = stack.splice(back + 1);
  for (const [k, at] of seen) if (at > back) seen.delete(k);
  return [stack[back]?.p as Vec2, ...loop.map((x) => x.p)];
}

/**
 * `r` split at its self-crossings into simple loops: walking it, a loop closes each time the walk comes back to a crossing it
 * passed (a figure eight gives its two lobes, a pentagram its five tips and its middle). A simple ring is its own one loop.
 */
export function simpleLoops(r: Ring): Ring[] {
  const marks = selfCrossings(r);
  if (marks.every((m) => m.length === 0)) return [r];
  const walk = r.flatMap((p, i): Visit[] => [{ p }, ...(marks[i] as Mark[]).map((m) => ({ p: m.at, id: m.id }))]);
  const loops: Ring[] = [];
  const stack: Visit[] = [];
  const seen = new Map<number, number>();
  for (const v of walk) {
    const back = v.id === undefined ? undefined : seen.get(v.id);
    if (back === undefined) {
      if (v.id !== undefined) seen.set(v.id, stack.length);
      stack.push(v);
    } else loops.push(closeLoop(stack, seen, back));
  }
  loops.push(stack.map((x) => x.p));
  return loops.filter((l) => l.length >= 3 && area2(l) !== 0);
}

/** The rings of the even-odd polygons whose union is the region of `rings` filled under nonzero: each R with w(R) ≠ 0, less its children. */
export function nonzeroParts(rings: readonly Ring[]): Ring[][] {
  const loops = rings.flatMap(simpleLoops);
  const size = loops.map((l) => Math.abs(area2(l)));
  // each loop's parent: the smallest larger loop holding its probe point
  const parent = loops.map((l, i) => {
    const p = probe(l);
    let best = -1;
    loops.forEach((o, j) => {
      if (j !== i && (size[j] as number) > (size[i] as number) && inRing(o, p) && (best < 0 || (size[j] as number) < (size[best] as number))) best = j;
    });
    return best;
  });
  const winding: number[] = [];
  const windingOf = (i: number): number => {
    if (winding[i] !== undefined) return winding[i] as number;
    const up = parent[i] as number;
    const w = (up < 0 ? 0 : windingOf(up)) + Math.sign(area2(loops[i] as Ring));
    winding[i] = w;
    return w;
  };
  return loops.flatMap((l, i) => (windingOf(i) === 0 ? [] : [[l, ...loops.filter((_, j) => parent[j] === i)]]));
}
