// Connector end markers (FR-CON-003): the schema's built-ins, registered in the render registries'
// `markers` by `builtinRegistries` (packs add theirs there too). A marker is sized in stroke widths
// (markerUnits strokeWidth), so it scales with the connector's stroke; its `inset` tells the view how
// far to trim the route so the line stops under the marker and the tip lands on the route's end.
import { MARKER_SIZE, type MarkerDef, type Registry } from '@fluxion/core';
import type { ReactNode } from 'react';

/**
 * The built-in markers of the schema's `Marker` type (`none` draws nothing and is not registered).
 *
 * @public
 */
export const BUILTIN_MARKERS: readonly MarkerDef[] = [
  // a notched arrowhead: the line stops at the notch
  { id: 'arrow', path: 'M0 0 L10 5 L0 10 L3 5 Z', inset: 7, filled: true },
  { id: 'triangle', path: 'M0 0 L10 5 L0 10 Z', inset: 10, filled: true },
  { id: 'diamond', path: 'M0 5 L5 0 L10 5 L5 10 Z', inset: 10, filled: true },
  { id: 'circle', path: 'M0 5 A5 5 0 1 1 10 5 A5 5 0 1 1 0 5 Z', inset: 10, filled: true },
  // a bar across the end: the line runs up to it
  { id: 'bar', path: 'M8 0 L10 0 L10 10 L8 10 Z', inset: 2, filled: true },
];

/**
 * Register the built-in markers into `markers` (source `core`); an id another source already holds
 * keeps that source's marker.
 *
 * @public
 */
export function registerBuiltinMarkers(markers: Registry<string, MarkerDef>): void {
  for (const def of BUILTIN_MARKERS) markers.register(def.id, def, 'core');
}

/**
 * The `<marker>` element `id` drawing `def` in `color` on a route of stroke `width` px whose end was
 * trimmed by `trim` px: the reference point sits that far back from the tip, so the tip lands on the
 * route's end even when the trim was capped short of the inset (M5.20 review F1).
 */
export function MarkerView(props: {
  readonly def: MarkerDef;
  readonly id: string;
  readonly color: string;
  readonly width: number;
  readonly trim: number;
}): ReactNode {
  const { def, id, color } = props;
  const unit = (MARKER_SIZE * props.width) / 10;
  // box units back from the tip; a stroke of no width draws no marker, where any reference point does
  const back = unit > 0 ? props.trim / unit : def.inset;
  // an open marker's stroke is as wide as the connector's: 10 box units span MARKER_SIZE stroke widths
  // a bevel join keeps a sharp tip within half a stroke of its vertex: a miter would reach past it (M5.36 review F1)
  const paint = def.filled
    ? { fill: color, stroke: 'none' }
    : { fill: 'none', stroke: color, strokeWidth: 10 / MARKER_SIZE, strokeLinejoin: 'bevel' as const, strokeLinecap: 'butt' as const };
  // auto-start-reverse turns the start marker to point away from the line, like the end one; the
  // reference point is where the trimmed route ends
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX={10 - back}
      refY="5"
      markerWidth={MARKER_SIZE}
      markerHeight={MARKER_SIZE}
      markerUnits="strokeWidth"
      orient="auto-start-reverse"
      overflow="visible"
    >
      <path d={def.path} style={paint} />
    </marker>
  );
}
