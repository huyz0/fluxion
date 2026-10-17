// Distribution along a side (ADR-0043, FR-ANC-007, FR-ANC-003): connectors that share a side of an element are sorted by the coordinate of
// their far end, so they do not cross, and spaced evenly along it. A side that already holds `max` connectors passes the next one to
// the adjacent side nearer its far end.
import type { Box, Vec2 } from '@fluxion/geometry';
import type { Side } from './auto-anchor.js';

/**
 * A connector end to place on a side.
 *
 * @public
 */
export type SlotEnd = {
  /** Identifies the end in the result. */
  readonly id: string;
  /** The element, so the ends on its sides are counted together. */
  readonly key: string;
  /** The element's box on screen. */
  readonly box: Box;
  /** The side chosen for it. */
  readonly side: Side;
  /** The other end of the connector. */
  readonly far: Vec2;
  /** The most connectors this side may hold (`maxConnections`); no limit when absent. */
  readonly max?: number | undefined;
};

/**
 * Where an end lands: its side and the fraction along it, 0 to 1 from the start of the side (left to right on n and s, top to bottom on e and w).
 *
 * @public
 */
export type Slot = {
  /** The end. */
  readonly id: string;
  /** The side it landed on, which may be the neighbour of the one asked for. */
  readonly side: Side;
  /** Position along the side, 0 to 1. */
  readonly t: number;
};

const NEIGHBOURS: Readonly<Record<Side, readonly [Side, Side]>> = { n: ['w', 'e'], e: ['n', 's'], s: ['w', 'e'], w: ['n', 's'] };

const horizontal = (s: Side): boolean => s === 'n' || s === 's';

/** The midpoint of a side, for judging which neighbour is nearer the far end. */
function middle(b: Box, s: Side): Vec2 {
  if (s === 'n') return { x: b.x + b.w / 2, y: b.y };
  if (s === 's') return { x: b.x + b.w / 2, y: b.y + b.h };
  return s === 'e' ? { x: b.x + b.w, y: b.y + b.h / 2 } : { x: b.x, y: b.y + b.h / 2 };
}

const distance = (a: Vec2, b: Vec2): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The side `end` ends up on: its own while it has room, else the neighbour with room nearer its far end, else its own. */
function place(end: SlotEnd, count: (key: string, s: Side) => number): Side {
  const room = (s: Side): boolean => count(end.key, s) < (end.max ?? Number.POSITIVE_INFINITY);
  if (room(end.side)) return end.side;
  const open = NEIGHBOURS[end.side].filter(room).sort((a, b) => distance(middle(end.box, a), end.far) - distance(middle(end.box, b), end.far));
  return open[0] ?? end.side;
}

/**
 * The slot of every end, in the order given. Ends are placed in order (so earlier ones keep a limited side), then each side's ends are
 * sorted by the far end's coordinate across the side and spaced evenly.
 *
 * @public
 */
export function distributeSlots(ends: readonly SlotEnd[]): Slot[] {
  const counts = new Map<string, number>();
  const count = (key: string, s: Side): number => counts.get(`${key}:${s}`) ?? 0;
  const sides = ends.map((end) => {
    const side = place(end, count);
    counts.set(`${end.key}:${side}`, count(end.key, side) + 1);
    return side;
  });
  const groups = new Map<string, number[]>();
  for (let i = 0; i < sides.length; i++) {
    const name = `${(ends[i] as SlotEnd).key}:${sides[i]}`;
    groups.set(name, [...(groups.get(name) ?? []), i]);
  }
  const t: number[] = [];
  for (const members of groups.values()) {
    const side = sides[members[0] as number] as Side;
    const across = (i: number): number => (horizontal(side) ? (ends[i] as SlotEnd).far.x : (ends[i] as SlotEnd).far.y);
    members.sort((a, b) => across(a) - across(b) || a - b);
    for (let rank = 0; rank < members.length; rank++) t[members[rank] as number] = (rank + 1) / (members.length + 1);
  }
  return ends.map((end, i) => ({ id: end.id, side: sides[i] as Side, t: t[i] as number }));
}
