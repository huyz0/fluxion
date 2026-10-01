// The edit overlay (FR-EDT-004, ADR-0028 §3, 04 §3.3): one SVG in canvas px above the content, taking
// no pointer events (the tools read the pointer on the canvas). It draws the hovered element's
// outline, the selection frame with its eight resize handles and rotate handle, and the marquee.
// Handles are drawn in canvas px, so they keep their size at any zoom.
import type { Store } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import { useValue } from '@fluxion/render';
import type { RouteContext } from '@fluxion/routing';
import { type ReactNode, useMemo } from 'react';
import { pageToScreen } from './camera.js';
import { HANDLE_PX, placements, screenBox, selectionFrame } from './overlay-geometry.js';
import { HandleMarks } from './overlay-marks.js';
import type { ShapeDefs } from './param-handles.js';
import type { Session } from './session.js';

const points = (ps: readonly Vec2[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');

/** Props of {@link Overlay}. */
export type OverlayProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose selection, hover, marquee and camera it draws. */
  readonly session: Session;
  /** The canvas size. */
  readonly box: { readonly w: number; readonly h: number };
  /** Where shape definitions are looked up: the one selected shape shows its parametric handles. */
  readonly shapeDefs?: ShapeDefs | undefined;
  /** What routes connectors: a selected or hovered connector is outlined along its route, and the one selected shows its handles. */
  readonly routes?: RouteContext | undefined;
};

/**
 * Whether the overlay has anything to draw: a selection, a hovered element, a marquee, a draft or a
 * sketch. Without, it is not mounted, so the canvas holds the content alone (the parity suite's
 * "overlay unmounted", FR-EDT-010).
 */
export function useOverlayShown(session: Session): boolean {
  const selection = useValue(session.selection.get);
  const hover = useValue(session.hover.get);
  const marquee = useValue(session.marquee.get);
  const draft = useValue(session.draft.get);
  const sketch = useValue(session.sketch.get);
  return selection.length > 0 || hover !== undefined || marquee !== undefined || draft !== undefined || sketch !== undefined;
}

/** The overlay over the canvas. */
export function Overlay(props: OverlayProps): ReactNode {
  const { store, session, box, shapeDefs, routes } = props;
  const camera = useValue(session.camera.get);
  const selection = useValue(session.selection.get);
  const hover = useValue(session.hover.get);
  const marquee = useValue(session.marquee.get);
  const draft = useValue(session.draft.get);
  const sketch = useValue(session.sketch.get);
  const placed = useValue(useMemo(() => store.query((view) => placements(view, selection)), [store, selection]));
  // a selected element is outlined by its frame already
  const hovered = useValue(
    useMemo(() => store.query((view) => (hover === undefined || selection.includes(hover) ? [] : placements(view, [hover]))), [store, hover, selection]),
  );
  const frame = selectionFrame(placed, camera);
  const outline = selectionFrame(hovered, camera);
  const band = marquee === undefined ? undefined : screenBox(marquee, camera);
  const drafted = draft === undefined ? undefined : screenBox(draft, camera);
  const line = sketch?.map((p) => pageToScreen(camera, p));
  const half = HANDLE_PX / 2;
  return (
    <svg className="fx-chrome-overlay" width={box.w} height={box.h} aria-hidden="true" data-testid="overlay">
      {outline === undefined ? null : <polygon className="fx-chrome-hover" points={points(outline.corners)} />}
      {frame === undefined ? null : (
        <g className="fx-chrome-selection">
          <polygon className="fx-chrome-frame" points={points(frame.corners)} />
          <line className="fx-chrome-frame" x1={frame.handles[1]?.[1].x} y1={frame.handles[1]?.[1].y} x2={frame.rotate.x} y2={frame.rotate.y} />
          <circle className="fx-chrome-handle" data-handle="rotate" cx={frame.rotate.x} cy={frame.rotate.y} r={half} />
          {frame.handles.map(([id, at]) => (
            <rect
              key={id}
              className="fx-chrome-handle"
              data-handle={id}
              x={at.x - half}
              y={at.y - half}
              width={HANDLE_PX}
              height={HANDLE_PX}
              transform={`rotate(${frame.rotation} ${at.x} ${at.y})`}
            />
          ))}
        </g>
      )}
      <HandleMarks store={store} session={session} shapeDefs={shapeDefs} routes={routes} />
      {band === undefined ? null : <rect className="fx-chrome-marquee" x={band.x} y={band.y} width={band.w} height={band.h} />}
      {drafted === undefined ? null : <rect className="fx-chrome-draft" x={drafted.x} y={drafted.y} width={drafted.w} height={drafted.h} />}
      {line === undefined ? null : <polyline className="fx-chrome-sketch" points={points(line)} />}
    </svg>
  );
}
