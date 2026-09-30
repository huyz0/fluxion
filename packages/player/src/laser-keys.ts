// The laser trail's pure parts (FR-EDT-003, FR-PRS-008): how long a dot fades, and the keys that keep
// a dot's node while it stays in the trail (laser-trail.tsx draws them).

/**
 * How long a laser dot takes to fade out.
 *
 * @public
 */
export const LASER_FADE = '0.8s';

/**
 * A point of the laser's trail, page units.
 *
 * @public
 */
export type LaserPoint = {
  /** Horizontal, page units. */
  readonly x: number;
  /** Vertical, page units. */
  readonly y: number;
};

/**
 * A trail point and its key.
 *
 * @public
 */
export type TrailDot = {
  /** The point. */
  readonly p: LaserPoint;
  /** Its key: its place, and which repeat of that place it is. */
  readonly key: string;
};

/**
 * The trail's points with keys that stay with a point while it stays in the trail, so each dot's fade
 * runs once from when it appeared.
 *
 * @public
 */
export function trailKeys(points: readonly LaserPoint[]): readonly TrailDot[] {
  const seen = new Map<string, number>();
  return points.map((p) => {
    const at = `${p.x},${p.y}`;
    const n = (seen.get(at) ?? 0) + 1;
    seen.set(at, n);
    return { p, key: `${at}#${n}` };
  });
}
