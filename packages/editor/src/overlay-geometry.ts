// Overlay geometry (FR-EDT-004, ADR-0028 §3, 04 §3.3): where the selection frame, its eight resize
// handles and its rotate handle are drawn, in canvas px. Handles sit outside the scaled content, so
// they keep HANDLE_PX whatever the zoom. One element's frame turns with it; several share their
// upright bounds. Pure: the overlay component only draws what this returns.
import { apply, type Box, boxFromPoints, elementMatrix, type Vec2 } from '@fluxion/geometry';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { type Camera, pageToScreen } from './camera.js';

/**
 * A box on the page: its unturned place and size, and its turn in degrees clockwise about its centre.
 *
 * @public
 */
export type Box2 = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly rot: number };

/**
 * The side of a resize handle, px on the canvas at any zoom.
 *
 * @public
 */
export const HANDLE_PX = 8;

/**
 * How far above the frame's top edge the rotate handle sits, px on the canvas.
 *
 * @public
 */
export const ROTATE_OFFSET_PX = 24;

/**
 * The resize handles, clockwise from the top-left corner.
 *
 * @public
 */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * Each handle's place on the frame, as fractions of its width and height.
 *
 * @public
 */
export const HANDLES: readonly (readonly [HandleId, number, number])[] = [
  ['nw', 0, 0],
  ['n', 0.5, 0],
  ['ne', 1, 0],
  ['e', 1, 0.5],
  ['se', 1, 1],
  ['s', 0.5, 1],
  ['sw', 0, 1],
  ['w', 0, 0.5],
];

/**
 * An element's placement as the overlay needs it (a record's `transform`).
 *
 * @public
 */
export type Placed = {
  /** Left edge of the unrotated box, page units. */
  readonly x: number;
  /** Top edge of the unrotated box. */
  readonly y: number;
  /** Width. */
  readonly w: number;
  /** Height. */
  readonly h: number;
  /** Rotation, degrees clockwise about the centre. */
  readonly rot?: number;
  /** Mirrored horizontally. */
  readonly flipX?: boolean;
  /** Mirrored vertically. */
  readonly flipY?: boolean;
};

/**
 * The selection frame on the canvas: its corners clockwise from the top-left, its turn, its handles
 * and the rotate handle.
 *
 * @public
 */
export type SelectionFrame = {
  /** The corners, clockwise from the frame's own top-left, canvas px. */
  readonly corners: readonly [Vec2, Vec2, Vec2, Vec2];
  /** The frame's turn, degrees clockwise. */
  readonly rotation: number;
  /** The resize handles' centres. */
  readonly handles: readonly (readonly [HandleId, Vec2])[];
  /** The rotate handle's centre. */
  readonly rotate: Vec2;
};

/**
 * A placed box's corners on the page, clockwise from its own top-left: flips mirror what is drawn
 * inside the box, not where the box is, so the frame's handles keep their places.
 */
function pageCorners(p: Placed): [Vec2, Vec2, Vec2, Vec2] {
  const m = elementMatrix({ x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot ?? 0, flipX: false, flipY: false });
  return [apply(m, { x: 0, y: 0 }), apply(m, { x: p.w, y: 0 }), apply(m, { x: p.w, y: p.h }), apply(m, { x: 0, y: p.h })];
}

/** The point at fractions (`u`, `v`) of the frame with these corners. */
function along(c: readonly [Vec2, Vec2, Vec2, Vec2], u: number, v: number): Vec2 {
  const top = { x: c[0].x + (c[1].x - c[0].x) * u, y: c[0].y + (c[1].y - c[0].y) * u };
  const bottom = { x: c[3].x + (c[2].x - c[3].x) * u, y: c[3].y + (c[2].y - c[3].y) * u };
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
}

/** The frame with these corners and turn, with its handles. */
function frameOf(corners: readonly [Vec2, Vec2, Vec2, Vec2], rotation: number): SelectionFrame {
  const handles = HANDLES.map(([id, u, v]) => [id, along(corners, u, v)] as const);
  const topMid = along(corners, 0.5, 0);
  const middle = along(corners, 0.5, 0.5);
  // outward from the frame's centre through its top edge's middle
  const dx = topMid.x - middle.x;
  const dy = topMid.y - middle.y;
  const len = Math.hypot(dx, dy);
  const out = len === 0 ? { x: 0, y: -1 } : { x: dx / len, y: dy / len };
  return { corners, rotation, handles, rotate: { x: topMid.x + out.x * ROTATE_OFFSET_PX, y: topMid.y + out.y * ROTATE_OFFSET_PX } };
}

/**
 * The frame of the elements placed at `placed`, seen through `camera`: one element's own turned
 * box, or the upright bounds of several. Undefined when nothing is placed.
 *
 * @public
 */
export function selectionFrame(placed: readonly Placed[], camera: Camera): SelectionFrame | undefined {
  const box = frameBox(placed);
  if (box === undefined) return undefined;
  const [a, b, c, d] = pageCorners(box).map((p) => pageToScreen(camera, p)) as [Vec2, Vec2, Vec2, Vec2];
  return frameOf([a, b, c, d], box.rot);
}

/**
 * The frame of the elements placed at `placed`, on the page: one element's own box and turn, or the
 * upright bounds of several. What the handles resize and rotate. Undefined when nothing is placed.
 *
 * @public
 */
export function frameBox(placed: readonly Placed[]): Box2 | undefined {
  const only = placed.length === 1 ? placed[0] : undefined;
  if (only !== undefined) return { x: only.x, y: only.y, w: only.w, h: only.h, rot: only.rot ?? 0 };
  const bounds: Box | null = boxFromPoints(placed.flatMap(pageCorners));
  return bounds === null ? undefined : { ...bounds, rot: 0 };
}

/**
 * The upright bounds on the page of the elements placed at `placed` (turned ones by their corners):
 * what zoom to selection fits. Undefined when nothing is placed.
 *
 * @public
 */
export function selectionBounds(placed: readonly Placed[]): Box | undefined {
  return boxFromPoints(placed.flatMap(pageCorners)) ?? undefined;
}

/**
 * The placements of the elements `ids` that have a box, in order (other records are left out).
 *
 * @public
 */
export function placements(view: { get(id: RecordId): AnyRecord | undefined }, ids: readonly RecordId[]): Placed[] {
  return ids.flatMap((id) => {
    const r = view.get(id);
    const t = r?.type === 'element' ? (r as { transform?: Placed }).transform : undefined;
    return t === undefined ? [] : [t];
  });
}

/** Whether canvas point `p` lies inside the frame's outline, whose corners run clockwise on the canvas. */
function insideFrame(frame: SelectionFrame, p: Vec2): boolean {
  const c = frame.corners;
  return c.every((a, i) => {
    const b = c[(i + 1) % 4] as Vec2;
    // tzap disable next-line EqualityOperator: a point exactly on the outline
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
  });
}

/**
 * The nearest handle of `frame` to canvas point `p`: a resize handle, or `rotate`. Outside the frame a handle
 * is picked within `size` canvas px (HANDLE_PX for a mouse, TOUCH.handlePx for a finger); inside it
 * only where it is drawn (HANDLE_PX / 2), so the middle of a small element is still the element's, to
 * move (M6.15 review F2), for a finger too.
 *
 * @public
 */
export function handleAt(frame: SelectionFrame | undefined, p: Vec2, size: number = HANDLE_PX): HandleId | 'rotate' | undefined {
  if (frame === undefined) return undefined;
  // inside, only where a handle is drawn, whatever reaches it: a small element's middle stays movable
  const reach = insideFrame(frame, p) ? HANDLE_PX / 2 : size;
  // the nearest handle within reach (a finger's reach spans several on a small frame); rotate wins a tie
  let best: { readonly id: HandleId | 'rotate'; readonly d: number } | undefined;
  for (const [id, at] of [['rotate', frame.rotate] as const, ...frame.handles]) {
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    // tzap disable next-line EqualityOperator: a press exactly a handle's reach away, or as near two
    if (d <= reach && (best === undefined || d < best.d)) best = { id, d };
  }
  return best?.id;
}

/**
 * The page box `box` on the canvas (a marquee), through `camera`.
 *
 * @public
 */
export function screenBox(box: Box, camera: Camera): Box {
  const a = pageToScreen(camera, { x: box.x, y: box.y });
  return { x: a.x, y: a.y, w: box.w * camera.z, h: box.h * camera.z };
}
