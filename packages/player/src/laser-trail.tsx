// The laser's trail (FR-PRS-008, FR-EDT-003; 04 §2.1 overlays layer): the presenter's pointer as a
// few red dots in page coordinates, drawn above a screen's elements. Each dot fades out on its own
// from when it appears (a CSS animation, so no clock in the code), so a trail left behind when the
// pointer stops fades away. It takes no pointer events and writes nothing.
import type { ReactNode } from 'react';
import { LASER_FADE, type LaserPoint, trailKeys } from './laser-keys.js';

/**
 * Props of {@link LaserTrail}.
 *
 * @public
 */
export type LaserTrailProps = {
  /** The pointer's recent positions, page units, newest last. */
  readonly points: readonly LaserPoint[];
  /** The screen's scale on the page (canvas px per page unit): dots keep their size on screen. */
  readonly scale: number;
};

/** A dot's fade: fully drawn, then gone. */
const FADE_KEYFRAMES = '@keyframes fx-laser-fade { from { opacity: 1; } to { opacity: 0; } }';

/**
 * The laser's trail over a screen: nothing when there are no points.
 *
 * @public
 */
export function LaserTrail(props: LaserTrailProps): ReactNode {
  const { points, scale } = props;
  if (points.length === 0) return null;
  const keyed = trailKeys(points);
  const r = 5 / scale;
  return (
    <svg
      className="fx-laser"
      aria-hidden="true"
      width={1}
      height={1}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      <style>{FADE_KEYFRAMES}</style>
      {keyed.map(({ p, key }) => (
        // a CSS animation starts when its dot is inserted (an SVG <animate> would run on the trail's
        // clock, so a dot added after the first LASER_FADE would appear already faded; M6.20 review F1)
        <circle key={key} cx={p.x} cy={p.y} r={r} fill="#ef4444" style={{ animation: `fx-laser-fade ${LASER_FADE} linear forwards` }} />
      ))}
    </svg>
  );
}
