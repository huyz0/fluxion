// A connector on the svg surface (ADR-0056 item 8, FR-EXP-004): the route the html view draws (the same query, the same rounding,
// hops, trims and decoration), in screen coordinates, stroked in literal attributes; SVG 1.1 end markers (`orient="auto"`, the start
// marker's path turned to point away from the line, since `auto-start-reverse` is SVG 2); and its labels laid out by layoutStyled,
// centred on their points of the route.
import { MARKER_SIZE, type MarkerDef, markerTrim, type TextMeasurer } from '@fluxion/core';
import { roundCorners } from '@fluxion/geometry';
import { labelPosition, type RoutePoint, routePoint, trimRoute } from '@fluxion/routing';
import type { ConnectorElement } from '@fluxion/schema';
import type { ResolvedFont, Theme } from '@fluxion/theme';
import { type ReactNode, type SVGAttributes, useId } from 'react';
import { decoratedRoute, hopped, markerOf, partPaint, styled, useRouted } from './connector-view.js';
import { pathData } from './path-data.js';
import type { ElementViewProps } from './registries.js';
import { lit, n3, opacityOf, strokeAttrs } from './svg-paint.js';
import { useSvgMeasurer } from './svg-surface.js';
import { SvgLabel } from './svg-text.js';
import { concreteFont } from './text-measurer.js';

/** A marker's paint as attributes: filled with `color`, or (an open marker) stroked as the html surface strokes it. */
const paint = (def: MarkerDef, color: string): SVGAttributes<SVGPathElement> =>
  def.filled
    ? { fill: color, stroke: 'none' }
    : { fill: 'none', stroke: color, strokeWidth: n3(10 / MARKER_SIZE), strokeLinejoin: 'bevel', strokeLinecap: 'butt' };

/** An SVG 1.1 `<marker>` for an end of the route: the start one drawn turned half round, so both point away from the line. */
function SvgMarker(props: {
  readonly def: MarkerDef;
  readonly id: string;
  readonly color: string;
  readonly width: number;
  readonly trim: number;
  readonly start: boolean;
}): ReactNode {
  const { def, color, start } = props;
  const unit = (MARKER_SIZE * props.width) / 10;
  const back = unit > 0 ? props.trim / unit : def.inset;
  return (
    <marker
      id={props.id}
      viewBox="0 0 10 10"
      refX={n3(start ? back : 10 - back)}
      refY="5"
      markerWidth={MARKER_SIZE}
      markerHeight={MARKER_SIZE}
      markerUnits="strokeWidth"
      orient="auto"
      overflow="visible"
    >
      <path d={def.path} transform={start ? 'rotate(180 5 5)' : undefined} {...paint(def, color)} />
    </marker>
  );
}

/** The mid marker at `at`, turned along the route there and sized in stroke widths, as the html surface draws it. */
function SvgMidMarker(props: { readonly def: MarkerDef; readonly at: RoutePoint; readonly color: string; readonly width: number }): ReactNode {
  const { def, at } = props;
  const angle = (Math.atan2(at.dir.y, at.dir.x) * 180) / Math.PI;
  const scale = (MARKER_SIZE * props.width) / 10;
  return (
    <g transform={`translate(${n3(at.point.x)} ${n3(at.point.y)}) rotate(${n3(angle)}) scale(${n3(scale)}) translate(-5 -5)`}>
      <path d={def.path} {...paint(def, props.color)} />
    </g>
  );
}

/** A label of plain lines centred on `at`: its box is as wide and tall as the text laid out. */
function ConnectorLabel(props: {
  readonly text: NonNullable<ConnectorElement['labels']>[number]['text'];
  readonly at: { readonly x: number; readonly y: number };
  readonly font: ResolvedFont;
  readonly opacity: string;
  readonly theme: Theme;
  readonly measurer: TextMeasurer;
}): ReactNode {
  const { at, font, theme } = props;
  const size = concreteFont(font, theme).size;
  // a label has no box of its own: room for a long line, centred on its point
  const w = Math.max(1, 40 * size);
  return (
    <SvgLabel
      doc={props.text}
      font={{ ...font, align: 'center', verticalAlign: 'middle' }}
      opacity={props.opacity}
      theme={theme}
      measurer={props.measurer}
      box={{ x: at.x - w / 2, y: at.y - size, w, h: 2 * size, padding: 0 }}
    />
  );
}

/**
 * The svg-surface view of `kind: 'connector'` elements.
 *
 * @public
 */
export function ConnectorSvg(props: ElementViewProps): ReactNode {
  const { store, theme, registries } = props;
  const element = props.element as ConnectorElement;
  const base = `fx-marker-${useId().replace(/[^\w-]/g, '')}`;
  const routed = useRouted(store, registries, element.id);
  const measurer = useSvgMeasurer();
  if (routed === undefined) return null;
  const { style, lengths } = styled(element.id, element.style, element.route.cornerRadius, theme);
  const { radius, width } = lengths;
  const ends = { start: markerOf(registries, element.markers?.start), end: markerOf(registries, element.markers?.end) };
  const mid = markerOf(registries, element.markers?.mid);
  const drawn = roundCorners(routed.commands, radius);
  const trimmed = trimRoute(hopped(routed, drawn, radius), markerTrim(ends.start, width), markerTrim(ends.end, width));
  const { decoration, decorated } = decoratedRoute(registries, element.route.type, trimmed.commands, width);
  const color = lit(style.stroke.color, theme) || 'none';
  const line = { fill: 'none', ...strokeAttrs(style.stroke, theme) };
  const opacity = opacityOf(style.opacity, theme);
  return (
    <g opacity={opacity === 1 ? undefined : opacity}>
      <Markers ends={ends} base={base} color={color} width={width} trimmed={trimmed} />
      {decorated.map((d, k) => {
        const part = partPaint(d.part, color) as { stroke: string; strokeOpacity?: number };
        // biome-ignore lint/suspicious/noArrayIndexKey: a decoration's strokes have no identity but their order
        return <path key={k} d={pathData(d.commands)} {...line} stroke={part.stroke} strokeOpacity={part.strokeOpacity} strokeWidth={n3(d.width)} />;
      })}
      <path
        d={pathData(trimmed.commands)}
        {...line}
        stroke={decoration === undefined ? line.stroke : 'none'}
        markerStart={ends.start === undefined ? undefined : `url(#${base}-start)`}
        markerEnd={ends.end === undefined ? undefined : `url(#${base}-end)`}
      />
      {mid === undefined ? null : <SvgMidMarker def={mid} at={routePoint(drawn, 0.5)} color={color} width={width} />}
      {(element.labels ?? []).map((label, k) => (
        <ConnectorLabel
          // biome-ignore lint/suspicious/noArrayIndexKey: a connector's labels have no identity but their order
          key={k}
          text={label.text}
          at={labelPosition(drawn, label.position, label.offset)}
          font={style.font}
          opacity="1"
          theme={theme}
          measurer={measurer}
        />
      ))}
    </g>
  );
}

/** The end markers' definitions, when the connector has any. */
function Markers(props: {
  readonly ends: { readonly start: MarkerDef | undefined; readonly end: MarkerDef | undefined };
  readonly base: string;
  readonly color: string;
  readonly width: number;
  readonly trimmed: { readonly start: number; readonly end: number };
}): ReactNode {
  const { ends, base, color, width, trimmed } = props;
  if (ends.start === undefined && ends.end === undefined) return null;
  return (
    <defs>
      {ends.start === undefined ? null : <SvgMarker def={ends.start} id={`${base}-start`} color={color} width={width} trim={trimmed.start} start />}
      {ends.end === undefined ? null : <SvgMarker def={ends.end} id={`${base}-end`} color={color} width={width} trim={trimmed.end} start={false} />}
    </defs>
  );
}
