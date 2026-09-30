// Overlay geometry (FR-EDT-004, ADR-0028 §3, 04 §3.3): where the selection frame, its eight resize
// handles and its rotate handle are drawn, in canvas px. Handles sit outside the scaled content, so
// they keep HANDLE_PX whatever the zoom. One element's frame turns with it; several share their
// upright bounds. Pure: the overlay component only draws what this returns.
import { apply, type Box, boxFromPoints, elementMatrix, type Vec2 } from '@fluxion/geometry';
import { type Camera, pageToScreen } from './camera.js';

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
  const only = placed.length === 1 ? placed[0] : undefined;
  if (only !== undefined) {
    const [a, b, c, d] = pageCorners(only).map((p) => pageToScreen(camera, p)) as [Vec2, Vec2, Vec2, Vec2];
    return frameOf([a, b, c, d], only.rot ?? 0);
  }
  const bounds = unionOf(placed);
  if (bounds === undefined) return undefined;
  const at = (x: number, y: number) => pageToScreen(camera, { x, y });
  return frameOf(
    [at(bounds.x, bounds.y), at(bounds.x + bounds.w, bounds.y), at(bounds.x + bounds.w, bounds.y + bounds.h), at(bounds.x, bounds.y + bounds.h)],
    0,
  );
}

/** The upright page bounds of several placed boxes, each turned. */
function unionOf(placed: readonly Placed[]): Box | undefined {
  return boxFromPoints(placed.flatMap(pageCorners)) ?? undefined;
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
