// The connector view (FR-CON-001, FR-RTE-001): the connector's route (routing's routeConnector: its ends
// through their bindings and anchors, the path from the router registered for its type), stroked with
// the resolved style (colour, width, dash, cap, join, opacity, token refs; FR-CON-005) with its bends
// rounded by the route's corner radius or else the style's; end markers from the markers registry,
// sized in stroke widths, with the route trimmed under them (FR-CON-003); and its labels at their
// fractions of the route (FR-CON-006; routing's labelPosition): plain paragraphs on a background. The
// wrapper has no box, so the SVG draws in screen coordinates; the route is a store query, so moving a
// bound shape redraws it.
import { type MarkerDef, markerTrim } from '@fluxion/core';
import { type PathCommand, roundCorners, type Vec2 } from '@fluxion/geometry';
import { labelPosition, routeConnector, trimRoute } from '@fluxion/routing';
import type { ConnectorElement, Marker } from '@fluxion/schema';
import { resolveStyle } from '@fluxion/theme';
import { type CSSProperties, type ReactNode, useId, useMemo } from 'react';
import { labelStyle, plainParagraphs } from './label.js';
import { MarkerView } from './markers.js';
import { pathData } from './path-data.js';
import type { ElementViewProps, RenderRegistries } from './registries.js';
import { concreteLength } from './text-measurer.js';
import { useValue } from './use-value.js';

/** Room around a route for its stroke and markers, px. */
const ROUTE_MARGIN = 24;

const round = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** Every point a path's commands name (ends and control points): its drawing lies within their box. */
const pointsOf = (commands: readonly PathCommand[]): Vec2[] =>
  commands.flatMap((c) => [...('control1' in c ? [c.control1, c.control2] : []), ...('control' in c ? [c.control] : []), ...('to' in c ? [c.to] : [])]);

/** The registered marker `marker` names (none for `none`, an absent or an unregistered one). */
const markerOf = (registries: RenderRegistries, marker: Marker | undefined): MarkerDef | undefined =>
  marker === undefined ? undefined : registries.markers.get(marker);

/** The labels of `element` placed along `route`, in `style`'s font. */
function Labels(props: { readonly element: ConnectorElement; readonly route: readonly PathCommand[]; readonly style: CSSProperties }): ReactNode {
  return (props.element.labels ?? []).map((label, k) => {
    const at = labelPosition(props.route, label.position, label.offset);
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: a connector's labels have no identity but their order
      <div key={k} className="fx-connector-label" style={{ ...props.style, left: round(at.x), top: round(at.y) }}>
        {plainParagraphs(label.text).map((text, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no identity but their order
          <p key={i}>{text}</p>
        ))}
      </div>
    );
  });
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
  const [start, end] = [markerOf(registries, element.markers?.start), markerOf(registries, element.markers?.end)];
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
  // the line stops under each marker, whose tip then lands on the route's end
  const width = concreteLength(style.stroke.width, theme);
  const trimmed = trimRoute(drawn, markerTrim(start, width), markerTrim(end, width));
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
  return (
    <>
      <svg className="fx-connector" aria-hidden="true" viewBox={`${round(x)} ${round(y)} ${round(w)} ${round(h)}`} style={box}>
        {start === undefined && end === undefined ? null : (
          <defs>
            {start === undefined ? null : <MarkerView def={start} id={`${base}-start`} color={style.stroke.color} width={width} trim={trimmed.start} />}
            {end === undefined ? null : <MarkerView def={end} id={`${base}-end`} color={style.stroke.color} width={width} trim={trimmed.end} />}
          </defs>
        )}
        <path
          className="fx-route"
          d={pathData(trimmed.commands)}
          style={line}
          markerStart={start === undefined ? undefined : `url(#${base}-start)`}
          markerEnd={end === undefined ? undefined : `url(#${base}-end)`}
        />
      </svg>
      <Labels element={element} route={drawn} style={labelStyle(style.font, style.opacity)} />
    </>
  );
}
