// The edit overlay (FR-EDT-004, ADR-0028 §3, 04 §3.3): one SVG in canvas px above the content, taking
// no pointer events (the tools read the pointer on the canvas). It draws the hovered element's
// outline, the selection frame with its eight resize handles and rotate handle, and the marquee.
// Handles are drawn in canvas px, so they keep their size at any zoom.
import type { ReadView, Store } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import { useValue } from '@fluxion/render';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { type ReactNode, useMemo } from 'react';
import { HANDLE_PX, type Placed, screenBox, selectionFrame } from './overlay-geometry.js';
import type { Session } from './session.js';

/** The placement of record `r`, when it is an element with a box. */
function placementOf(r: AnyRecord | undefined): Placed | undefined {
  return r?.type === 'element' ? (r as { transform?: Placed }).transform : undefined;
}

/** The placements of the elements `ids` that have a box, in order. */
const placements = (view: ReadView, ids: readonly RecordId[]): Placed[] =>
  ids.map((id) => placementOf(view.get(id))).filter((p): p is Placed => p !== undefined);

const points = (ps: readonly Vec2[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');

/** Props of {@link Overlay}. */
export type OverlayProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose selection, hover, marquee and camera it draws. */
  readonly session: Session;
  /** The canvas size. */
  readonly box: { readonly w: number; readonly h: number };
};

/** The overlay over the canvas. */
export function Overlay(props: OverlayProps): ReactNode {
  const { store, session, box } = props;
  const camera = useValue(session.camera.get);
  const selection = useValue(session.selection.get);
  const hover = useValue(session.hover.get);
  const marquee = useValue(session.marquee.get);
  const placed = useValue(useMemo(() => store.query((view) => placements(view, selection)), [store, selection]));
  // a selected element is outlined by its frame already
  const hovered = useValue(
    useMemo(() => store.query((view) => (hover === undefined || selection.includes(hover) ? [] : placements(view, [hover]))), [store, hover, selection]),
  );
  const frame = selectionFrame(placed, camera);
  const outline = selectionFrame(hovered, camera);
  const band = marquee === undefined ? undefined : screenBox(marquee, camera);
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
      {band === undefined ? null : <rect className="fx-chrome-marquee" x={band.x} y={band.y} width={band.w} height={band.h} />}
    </svg>
  );
}
