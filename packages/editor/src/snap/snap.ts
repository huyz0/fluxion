// The snapping engine (FR-ARR-005, M8.9): pure. A box being moved or resized is brought to the nearest target on each
// axis, within 8 px of the screen (so 8 / zoom page units): the edges and centres of other elements, the positions
// that put it midway between two neighbours or at the gap two neighbours already keep, the edges and centre of the
// screen, and a grid. The nearest wins; a tie goes to the more specific target (an element before a gap before the
// screen before the grid). Alt bypasses all of it. The overlay draws the guides it returns (M8.10).
import type { Box } from '@fluxion/geometry';

/**
 * How far, on screen, a target pulls, px.
 *
 * @public
 */
export const SNAP_PX = 8;

/**
 * The increment a rotation snaps to, degrees, and how near it must be.
 *
 * @public
 */
export const ROTATE_SNAP_STEP = 15;
/** How near, in degrees, a turn must be to an increment to snap to it. */
const ROTATE_SNAP_DEG = 3;

/**
 * The reach of a snap in page units at `zoom`: 8 screen px.
 *
 * @public
 */
export const snapThreshold = (zoom: number): number => SNAP_PX / zoom;

/**
 * What a snapped position lines up with.
 *
 * @public
 */
export type SnapKind = 'edge' | 'center' | 'gap' | 'screen' | 'grid';

/**
 * A guide to draw: the line at `at` along `axis` (an `x` guide is vertical), from `from` to `to` on the other axis.
 *
 * @public
 */
export type SnapGuide = {
  /** The axis the line fixes. */
  readonly axis: 'x' | 'y';
  /** Its coordinate on that axis. */
  readonly at: number;
  /** Where it starts on the other axis. */
  readonly from: number;
  /** Where it ends on the other axis. */
  readonly to: number;
  /** What it lines up with. */
  readonly kind: SnapKind;
  /** For a `gap` guide: the equal gap the snapped box keeps, page units (its label). */
  readonly distance?: number;
};

/**
 * What a snap does to a box: the shift to apply on each axis, and the guides of what it now lines up with.
 *
 * @public
 */
export type SnapResult = {
  /** The shift along x. */
  readonly dx: number;
  /** The shift along y. */
  readonly dy: number;
  /** The guides to draw. */
  readonly guides: readonly SnapGuide[];
};

/**
 * What snapping reads besides the boxes.
 *
 * @public
 */
export type SnapOptions = {
  /** The canvas zoom: the reach is 8 screen px. */
  readonly zoom: number;
  /** The grid cell in page units, when the grid is on. */
  readonly grid?: number;
  /** The screen's size (its box is at 0,0), when its edges and centre are targets. */
  readonly screen?: {
    /** Its width. */
    readonly w: number;
    /** Its height. */
    readonly h: number;
  };
  /** Alt held: no snapping. */
  readonly bypass?: boolean;
};

type Axis = 'x' | 'y';
type Anchor = 'min' | 'mid' | 'max';
/** A line a moving anchor can snap to: its value, what it is, its tie rank (lower first), and the stretch of the other axis it spans. */
type Line = {
  readonly value: number;
  readonly kind: SnapKind;
  readonly rank: number;
  readonly anchor?: Anchor;
  readonly gap?: number;
  readonly span: readonly [number, number];
};

const POS = { x: 'x', y: 'y' } as const;
const SIZE = { x: 'w', y: 'h' } as const;
const OTHER: { readonly [A in Axis]: Axis } = { x: 'y', y: 'x' };
const ANCHORS: readonly Anchor[] = ['min', 'mid', 'max'];
const RANK = { edge: 0, center: 0, gap: 1, screen: 2, grid: 3 } as const;
/** Boxes considered for gaps: the nearest this many, so a crowded screen costs no more than a sparse one. */
const GAP_NEIGHBOURS = 12;

const lo = (b: Box, a: Axis) => b[POS[a]];
const hi = (b: Box, a: Axis) => b[POS[a]] + b[SIZE[a]];
const at = (b: Box, a: Axis, anchor: Anchor) => (anchor === 'min' ? lo(b, a) : anchor === 'max' ? hi(b, a) : (lo(b, a) + hi(b, a)) / 2);
const span = (b: Box, a: Axis): readonly [number, number] => [lo(b, OTHER[a]), hi(b, OTHER[a])];

/** The lines of other boxes: their edges and centres. */
function boxLines(others: readonly Box[], axis: Axis): Line[] {
  return others.flatMap((b) => [
    { value: lo(b, axis), kind: 'edge' as const, rank: RANK.edge, span: span(b, axis) },
    { value: (lo(b, axis) + hi(b, axis)) / 2, kind: 'center' as const, rank: RANK.center, span: span(b, axis) },
    { value: hi(b, axis), kind: 'edge' as const, rank: RANK.edge, span: span(b, axis) },
  ]);
}

/** The lines of the screen: its edges and centre. */
function screenLines(size: { readonly w: number; readonly h: number }, axis: Axis): Line[] {
  const length = axis === 'x' ? size.w : size.h;
  const across: readonly [number, number] = [0, axis === 'x' ? size.h : size.w];
  return [0, length / 2, length].map((value) => ({ value, kind: 'screen' as const, rank: RANK.screen, span: across }));
}

/** The grid line nearest each anchor of `box`. */
function gridLines(box: Box, axis: Axis, cell: number): Line[] {
  const across = span(box, axis);
  return ANCHORS.map((a) => ({ value: Math.round(at(box, axis, a) / cell) * cell, kind: 'grid' as const, rank: RANK.grid, span: across }));
}

/** The boxes beside `box` on `axis`: those sharing some of its extent on the other axis, the nearest few, in order along `axis`. */
function neighbours(box: Box, others: readonly Box[], axis: Axis): Box[] {
  const [a, b] = span(box, axis);
  const centre = at(box, axis, 'mid');
  return others
    .filter((o) => lo(o, OTHER[axis]) <= b && hi(o, OTHER[axis]) >= a)
    .sort((p, q) => Math.abs(at(p, axis, 'mid') - centre) - Math.abs(at(q, axis, 'mid') - centre))
    .slice(0, GAP_NEIGHBOURS)
    .sort((p, q) => lo(p, axis) - lo(q, axis));
}

/** The lines that put `box` midway between two neighbours, or at the gap two neighbours keep (before, after or beside them). */
function gapLines(box: Box, others: readonly Box[], axis: Axis): Line[] {
  const near = neighbours(box, others, axis);
  const size = box[SIZE[axis]];
  const out: Line[] = [];
  const draw = (value: number, anchor: Anchor, [from, to]: readonly [Box, Box], gap: number) => {
    const [a, b] = [Math.min(span(from, axis)[0], span(to, axis)[0]), Math.max(span(from, axis)[1], span(to, axis)[1])];
    out.push({ value, kind: 'gap', rank: RANK.gap, anchor, gap, span: [a, b] });
  };
  for (const [i, c] of near.entries()) {
    for (const d of near.slice(i + 1)) {
      const free = lo(d, axis) - hi(c, axis);
      if (free < 0) continue;
      // midway: equal gaps either side of the box
      if (free >= size) draw(hi(c, axis) + (free - size) / 2, 'min', [c, d], (free - size) / 2);
      // the gap they keep, repeated after d and before c
      draw(hi(d, axis) + free, 'min', [c, d], free);
      draw(lo(c, axis) - free, 'max', [c, d], free);
    }
  }
  return out;
}

type Candidate = { readonly delta: number; readonly line: Line; readonly distance: number };

/** Whether `a` beats `b`: nearer, or as near and more specific. */
const better = (a: Candidate, b: Candidate | undefined): boolean =>
  b === undefined || a.distance < b.distance || (a.distance === b.distance && a.line.rank < b.line.rank);

/** The nearest line for an axis, as the shift that brings the box's anchor to it; undefined when none is in reach. */
function nearest(box: Box, axis: Axis, lines: readonly Line[], reach: number): Candidate | undefined {
  const candidates = lines.flatMap((line) =>
    (line.anchor === undefined ? ANCHORS : [line.anchor]).map((anchor): Candidate => {
      const delta = line.value - at(box, axis, anchor);
      return { delta, line, distance: Math.abs(delta) };
    }),
  );
  return candidates.filter((c) => c.distance <= reach).reduce<Candidate | undefined>((best, c) => (better(c, best) ? c : best), undefined);
}

/** Every line the snapped `box` lies on, as a guide spanning the box and the thing it lines up with. */
function guidesFor(box: Box, axis: Axis, lines: readonly Line[]): SnapGuide[] {
  const own = span(box, axis);
  // lines alike (same place, kind and gap, as when two boxes share an edge) are one guide, spanning them all
  const out = new Map<string, SnapGuide>();
  for (const line of lines) {
    const on = (line.anchor === undefined ? ANCHORS : [line.anchor]).some((a) => Math.abs(at(box, axis, a) - line.value) < 1e-6);
    if (!on) continue;
    const key = `${line.kind}:${line.value}:${line.gap}`;
    const known = out.get(key);
    out.set(key, {
      axis,
      at: line.value,
      from: Math.min(known?.from ?? own[0], own[0], line.span[0]),
      to: Math.max(known?.to ?? own[1], own[1], line.span[1]),
      kind: line.kind,
      ...(line.gap === undefined ? {} : { distance: line.gap }),
    });
  }
  return [...out.values()];
}

/**
 * `box` brought to the nearest targets on each axis within 8 screen px: the shift to apply and the guides of what it
 * then lines up with. With `bypass`, no shift. The shift never exceeds `snapThreshold(zoom)` on an axis.
 *
 * @public
 */
export function snapBox(box: Box, others: readonly Box[], options: SnapOptions): SnapResult {
  if (options.bypass === true) return { dx: 0, dy: 0, guides: [] };
  const reach = snapThreshold(options.zoom);
  const linesFor = (axis: Axis): Line[] => [
    ...boxLines(others, axis),
    ...gapLines(box, others, axis),
    ...(options.screen === undefined ? [] : screenLines(options.screen, axis)),
    ...(options.grid === undefined ? [] : gridLines(box, axis, options.grid)),
  ];
  const [xs, ys] = [linesFor('x'), linesFor('y')];
  const [bx, by] = [nearest(box, 'x', xs, reach), nearest(box, 'y', ys, reach)];
  const [dx, dy] = [bx?.delta ?? 0, by?.delta ?? 0];
  const snapped = { ...box, x: box.x + dx, y: box.y + dy };
  const guides = [...(bx === undefined ? [] : guidesFor(snapped, 'x', xs)), ...(by === undefined ? [] : guidesFor(snapped, 'y', ys))];
  return { dx, dy, guides };
}

/**
 * The grid cell the Grid toggle snaps to, page units.
 *
 * @public
 */
export const GRID_CELL = 24;

/**
 * A resize with its moved edges snapped.
 *
 * @public
 */
export type SnapResizeResult = {
  /** The box with the moved edges on their targets. */
  readonly box: Box;
  /** The guides of what they line up with. */
  readonly guides: readonly SnapGuide[];
};

/**
 * `box` with the edges a resize moves brought to the nearest targets: `edges` is which edge each axis moves (-1 the low
 * edge, 1 the high edge, 0 none, as the resize handles), and the other edges stay where they are. Returns the box and
 * the guides of what the moved edges line up with. With `bypass`, as given.
 *
 * @public
 */
export function snapResize(box: Box, edges: readonly [-1 | 0 | 1, -1 | 0 | 1], others: readonly Box[], options: SnapOptions): SnapResizeResult {
  const [ex, ey] = edges;
  // the moved edges (or corner) as a point: a box without size has one position to bring to a target
  const edge = { x: ex < 0 ? box.x : box.x + box.w, y: ey < 0 ? box.y : box.y + box.h, w: 0, h: 0 };
  const hit = snapBox(edge, others, options);
  const dx = ex === 0 ? 0 : hit.dx;
  const dy = ey === 0 ? 0 : hit.dy;
  const out = {
    x: ex < 0 ? box.x + dx : box.x,
    y: ey < 0 ? box.y + dy : box.y,
    w: box.w + (ex < 0 ? -dx : ex > 0 ? dx : 0),
    h: box.h + (ey < 0 ? -dy : ey > 0 ? dy : 0),
  };
  return { box: out, guides: hit.guides.filter((g) => (g.axis === 'x' ? ex !== 0 : ey !== 0)) };
}

/**
 * `degrees` brought to the nearest multiple of `step` (15° by default) when within 3° of it, within [0, 360); else as
 * given. With `bypass`, as given.
 *
 * @public
 */
export function snapAngle(degrees: number, options: { readonly step?: number; readonly bypass?: boolean } = {}): number {
  if (options.bypass === true) return degrees;
  const step = options.step ?? ROTATE_SNAP_STEP;
  const target = Math.round(degrees / step) * step;
  return Math.abs(degrees - target) <= ROTATE_SNAP_DEG ? ((target % 360) + 360) % 360 : degrees;
}
