// The connector view (FR-CON-001, FR-RTE-001): the connector's route (routing's routeConnector: its ends
// through their bindings and anchors, the path from the router registered for its type), stroked with
// the resolved style (colour, width, dash, cap, join, opacity, token refs; FR-CON-005) with its bends
// rounded by the route's corner radius or else the style's; end markers from the markers registry,
// sized in stroke widths, with the route trimmed under them, and a mid marker at its midpoint (FR-CON-003); and its labels at their
// fractions of the route (FR-CON-006; routing's labelPosition): plain paragraphs on the screen's
// background colour. The
// wrapper has no box, so the SVG draws in screen coordinates; the route is a store query, so moving a
// bound shape redraws it.
import { type MarkerDef, markerTrim } from '@fluxion/core';
import { type PathCommand, roundCorners, type Vec2 } from '@fluxion/geometry';
import { hopPath, labelPosition, routeConnector, routePoint, trimRoute } from '@fluxion/routing';
import type { ConnectorElement, Marker, RecordId } from '@fluxion/schema';
import { resolveStyle } from '@fluxion/theme';
import { type CSSProperties, type ReactNode, useContext, useId, useMemo, useRef } from 'react';
import { concreteLength } from './css-values.js';
import { labelStyle } from './label.js';
import { BuildHiddenContext, type ConnectorHops, hopsOfConnector, visibleHops } from './line-jumps.js';
import { MarkerView, MidMarker } from './markers.js';
import { pathData } from './path-data.js';
import type { ElementViewProps, RenderRegistries } from './registries.js';
import { RenderStatsContext } from './render-stats.js';
import { RichText } from './rich-text.js';
import { useValue } from './use-value.js';

/** Room around a route for its stroke and markers, px. */
const ROUTE_MARGIN = 24;

/** How far past a route a box that has to grow reaches: a connector being dragged then keeps its box for the next stretch of the drag. */
const GROW_SLACK = 160;

/** A box in screen coordinates. */
type Frame = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/**
 * The box to draw in: `held` while `need` fits inside it (a drag then changes the path alone, not the SVG's box and view box),
 * else `need` and, once there was a box before, `GROW_SLACK` around the union of both. The first box is exactly the route's,
 * and so is one after the route shrank well inside the held box (more than two slacks spare on an axis).
 */
function framed(held: Frame | undefined, need: Frame): Frame {
  if (held === undefined || held.w > need.w + 4 * GROW_SLACK || held.h > need.h + 4 * GROW_SLACK) return need;
  if (held.x <= need.x && held.y <= need.y && held.x + held.w >= need.x + need.w && held.y + held.h >= need.y + need.h) return held;
  const [x, y] = [Math.min(held.x, need.x) - GROW_SLACK, Math.min(held.y, need.y) - GROW_SLACK];
  return { x, y, w: Math.max(held.x + held.w, need.x + need.w) + GROW_SLACK - x, h: Math.max(held.y + held.h, need.y + need.h) + GROW_SLACK - y };
}

const round = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** Every point a path's commands name (ends and control points): its drawing lies within their box. */
const pointsOf = (commands: readonly PathCommand[]): Vec2[] =>
  commands.flatMap((c) => [...('control1' in c ? [c.control1, c.control2] : []), ...('control' in c ? [c.control] : []), ...('to' in c ? [c.to] : [])]);

/** The box of a route: its points' bounds plus room for the stroke and markers. */
function routeFrame(commands: readonly PathCommand[]): Frame {
  const points = pointsOf(commands);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x, y] = [Math.min(...xs) - ROUTE_MARGIN, Math.min(...ys) - ROUTE_MARGIN];
  return { x, y, w: Math.max(...xs) - Math.min(...xs) + 2 * ROUTE_MARGIN, h: Math.max(...ys) - Math.min(...ys) + 2 * ROUTE_MARGIN };
}

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
        <RichText doc={label.text} />
      </div>
    );
  });
}

/**
 * The stroke of a route: `drawn` (the route with its corners rounded), or with hops a route of straight segments (the only kind given
 * hops) with a hop at each crossing that fits, its corners rounded to `radius`.
 */
function hopped(
  routed: { readonly commands: readonly PathCommand[]; readonly hops: ConnectorHops | undefined },
  drawn: readonly PathCommand[],
  radius: number,
): readonly PathCommand[] {
  if (routed.hops === undefined) return drawn;
  const points = routed.commands.map((c) => (c as { readonly to: Vec2 }).to);
  return roundCorners(hopPath(points, routed.hops.jumps, routed.hops.style), radius);
}

/** The style of a connector with what is derived from it: its stroke as CSS, the corner radius and the stroke width in px. */
function styled(id: RecordId, own: ConnectorElement['style'], cornerRadius: number | undefined, theme: ElementViewProps['theme']) {
  const { style } = resolveStyle(own, 'connector', theme, ['records', id, 'style']);
  const line: CSSProperties = {
    fill: 'none',
    stroke: style.stroke.color,
    strokeWidth: style.stroke.width,
    strokeLinecap: style.stroke.cap as CSSProperties['strokeLinecap'],
    strokeLinejoin: style.stroke.join as CSSProperties['strokeLinejoin'],
    ...(style.stroke.dash === undefined ? {} : { strokeDasharray: style.stroke.dash }),
  };
  const lengths = { radius: cornerRadius ?? concreteLength(style.radius, theme), width: concreteLength(style.stroke.width, theme) };
  return { style, line, lengths };
}

/**
 * The connector's route: the cheap pass (routeConnector's default, FR-RTE-002), or the global pass's route while it is current (FR-RTE-003),
 * with the hops it draws where it crosses connectors painted before it (FR-CON-008). The query re-runs only when something the route read
 * changes, so moving a shape reroutes the connectors bound to it and no others; its hops are a query of its own entry, and a hop over a
 * connector a build hides is left out.
 */
function useRouted(store: ElementViewProps['store'], registries: RenderRegistries, id: RecordId) {
  const record = useContext(RenderStatsContext);
  const hidden = useContext(BuildHiddenContext);
  return useValue(
    useMemo(() => {
      const hops = hopsOfConnector(store, registries, id);
      return store.query((view) => {
        const t0 = record === undefined ? 0 : performance.now();
        const route = routeConnector(view, registries, id);
        if (record !== undefined) record('route', performance.now() - t0);
        const global = registries.refined?.()?.get(id) === route?.commands;
        return route === undefined ? undefined : { ...route, global, hops: visibleHops(view, hops(), hidden) };
      });
    }, [store, registries, id, record, hidden]),
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
  const routed = useRouted(store, registries, id);
  // the box drawn in last render for this store, kept while the route fits it (another document starts afresh)
  const frames = useRef<{ readonly store: unknown; readonly frame: Frame } | undefined>(undefined);
  const { style, line, lengths } = useMemo(
    () => styled(id, element.style, element.route.cornerRadius, theme),
    [id, element.style, element.route.cornerRadius, theme],
  );
  if (routed === undefined) return null;
  const [start, end, mid] = [
    markerOf(registries, element.markers?.start),
    markerOf(registries, element.markers?.end),
    markerOf(registries, element.markers?.mid),
  ];
  const { radius, width } = lengths;
  // labels and the mid marker sit on the route; the stroke takes the hops as well
  const drawn = roundCorners(routed.commands, radius);
  const stroked = hopped(routed, drawn, radius);
  // the line stops under each marker, whose tip then lands on the route's end
  const trimmed = trimRoute(stroked, markerTrim(start, width), markerTrim(end, width));
  // the SVG covers the route's box plus room for the stroke and markers, its viewBox in screen
  // coordinates: an empty SVG box with visible overflow is not painted by every engine (M4.21)
  const held = frames.current?.store === store ? frames.current.frame : undefined;
  const { x, y, w, h } = framed(held, routeFrame(stroked));
  frames.current = { store, frame: { x, y, w, h } };
  const box: CSSProperties = { left: x, top: y, width: w, height: h, opacity: style.opacity };
  return (
    <>
      <svg
        className="fx-connector"
        data-route-pass={routed.global ? 'global' : undefined}
        aria-hidden="true"
        viewBox={`${round(x)} ${round(y)} ${round(w)} ${round(h)}`}
        style={box}
      >
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
        {mid === undefined ? null : <MidMarker def={mid} at={routePoint(drawn, 0.5)} color={style.stroke.color} width={width} />}
      </svg>
      <Labels element={element} route={drawn} style={labelStyle(style.font, style.opacity)} />
    </>
  );
}
