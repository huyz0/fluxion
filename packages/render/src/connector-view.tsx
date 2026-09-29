// The connector view (FR-CON-001, FR-RTE-001): the connector's route (routing's routeConnector: its ends
// through their bindings and anchors, the path from the router registered for its type), stroked with
// the resolved style (colour, width, dash, cap, join, opacity, token refs; FR-CON-005) with its bends
// rounded by the route's corner radius or else the style's, with end markers from a marker table (R0:
// `arrow`; the markers registry arrives with M5.20), and its labels at their fractions of the route
// (FR-CON-006; routing's labelPosition): plain paragraphs on the screen's background colour. The wrapper has no box, so the SVG draws in screen coordinates; the route is a store
// query, so moving a bound shape redraws it.
import { type PathCommand, roundCorners, type Vec2 } from '@fluxion/geometry';
import { labelPosition, routeConnector } from '@fluxion/routing';
import type { ConnectorElement, Marker } from '@fluxion/schema';
import { resolveStyle } from '@fluxion/theme';
import { type CSSProperties, type ReactNode, useId, useMemo } from 'react';
import { labelStyle, plainParagraphs } from './label.js';
import { pathData } from './path-data.js';
import type { ElementViewProps } from './registries.js';
import { concreteLength } from './text-measurer.js';
import { useValue } from './use-value.js';

/** Room around a route for its stroke and markers, px. */
const ROUTE_MARGIN = 24;

const round = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** Every point a path's commands name (ends and control points): its drawing lies within their box. */
const pointsOf = (commands: readonly PathCommand[]): Vec2[] =>
  commands.flatMap((c) => [...('control1' in c ? [c.control1, c.control2] : []), ...('control' in c ? [c.control] : []), ...('to' in c ? [c.to] : [])]);

/** Marker shapes in a 10 × 10 box whose tip is at (10, 5); unlisted markers draw nothing yet. */
const MARKER_PATHS: { readonly [marker: string]: string } = { arrow: 'M0 0 L10 5 L0 10 Z' };

/** The `<marker>` for `marker` at one end, or nothing. */
function markerDef(marker: Marker | undefined, id: string, color: string): ReactNode {
  const d = marker === undefined ? undefined : MARKER_PATHS[marker];
  if (d === undefined) return null;
  // auto-start-reverse turns the start marker to point away from the line, like the end one
  return (
    <marker id={id} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d={d} style={{ fill: color }} />
    </marker>
  );
}

/**
 * The view of `kind: 'connector'` elements.
 *
 * @public
 */
export function ConnectorView(props: ElementViewProps): ReactNode {
  const { store, theme, registries } = props;
  const element = props.element as ConnectorElement;
  const { id } = element;
  const base = `fx-marker-${useId().replace(/[^\w-]/g, '')}`;
  const routed = useValue(useMemo(() => store.query((view) => routeConnector(view, registries, id)), [store, registries, id]));
  const { style } = useMemo(() => resolveStyle(element.style, 'connector', theme, ['records', id, 'style']), [element.style, theme, id]);
  if (routed === undefined) return null;
  const start = markerDef(element.markers?.start, `${base}-start`, style.stroke.color);
  const end = markerDef(element.markers?.end, `${base}-end`, style.stroke.color);
  const line: CSSProperties = {
    fill: 'none',
    stroke: style.stroke.color,
    strokeWidth: style.stroke.width,
    strokeLinecap: style.stroke.cap as CSSProperties['strokeLinecap'],
    strokeLinejoin: style.stroke.join as CSSProperties['strokeLinejoin'],
    ...(style.stroke.dash === undefined ? {} : { strokeDasharray: style.stroke.dash }),
  };
  // bends round with the route's corner radius, else the style's (0: none); each fillet at most halfway along its segments
  const radius = element.route.cornerRadius ?? concreteLength(style.radius, theme);
  const drawn = roundCorners(routed.commands, radius);
  // the SVG covers the route's box plus room for the stroke and markers, its viewBox in screen
  // coordinates: an empty SVG box with visible overflow is not painted by every engine (M4.21)
  const points = pointsOf(drawn);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - ROUTE_MARGIN;
  const y = Math.min(...ys) - ROUTE_MARGIN;
  const w = Math.max(...xs) - Math.min(...xs) + 2 * ROUTE_MARGIN;
  const h = Math.max(...ys) - Math.min(...ys) + 2 * ROUTE_MARGIN;
  const box: CSSProperties = { left: x, top: y, width: w, height: h, opacity: style.opacity };
  const labels = (element.labels ?? []).map((label, k) => {
    const at = labelPosition(drawn, label.position, label.offset);
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: a connector's labels have no identity but their order
      <div key={k} className="fx-connector-label" style={{ ...labelStyle(style.font, style.opacity), left: round(at.x), top: round(at.y) }}>
        {plainParagraphs(label.text).map((text, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no identity but their order
          <p key={i}>{text}</p>
        ))}
      </div>
    );
  });
  return (
    <>
      <svg className="fx-connector" aria-hidden="true" viewBox={`${round(x)} ${round(y)} ${round(w)} ${round(h)}`} style={box}>
        {start === null && end === null ? null : (
          <defs>
            {start}
            {end}
          </defs>
        )}
        <path
          className="fx-route"
          d={pathData(drawn)}
          style={line}
          markerStart={start === null ? undefined : `url(#${base}-start)`}
          markerEnd={end === null ? undefined : `url(#${base}-end)`}
        />
      </svg>
      {labels}
    </>
  );
}
