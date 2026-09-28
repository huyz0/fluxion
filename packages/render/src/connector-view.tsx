// The connector view (FR-CON-001): a straight line between the connector's ends (connector-ends.ts),
// stroked with the resolved style, with end markers from a marker table (R0: `arrow`; the markers
// registry arrives with M5). The wrapper has no box, so the SVG draws in screen coordinates; the ends
// are a store query, so moving a bound shape redraws the line.
import type { ConnectorElement, Marker } from '@fluxion/schema';
import { resolveStyle } from '@fluxion/theme';
import { type CSSProperties, type ReactNode, useId, useMemo } from 'react';
import { connectorEnds } from './connector-ends.js';
import { pathData } from './path-data.js';
import type { ElementViewProps } from './registries.js';
import { useValue } from './use-value.js';

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
  const { store, theme } = props;
  const element = props.element as ConnectorElement;
  const { id } = element;
  const base = `fx-marker-${useId().replace(/[^\w-]/g, '')}`;
  const ends = useValue(useMemo(() => store.query((view) => connectorEnds(view, id)), [store, id]));
  const { style } = useMemo(() => resolveStyle(element.style, 'connector', theme, ['records', id, 'style']), [element.style, theme, id]);
  if (ends === undefined) return null;
  const start = markerDef(element.markers?.start, `${base}-start`, style.stroke.color);
  const end = markerDef(element.markers?.end, `${base}-end`, style.stroke.color);
  const line: CSSProperties = {
    fill: 'none',
    stroke: style.stroke.color,
    strokeWidth: style.stroke.width,
    strokeLinecap: style.stroke.cap as CSSProperties['strokeLinecap'],
    ...(style.stroke.dash === undefined ? {} : { strokeDasharray: style.stroke.dash }),
  };
  return (
    <svg className="fx-connector" aria-hidden="true" style={{ opacity: style.opacity }}>
      {start === null && end === null ? null : (
        <defs>
          {start}
          {end}
        </defs>
      )}
      <path
        className="fx-route"
        d={pathData([
          { kind: 'M', to: ends.source },
          { kind: 'L', to: ends.target },
        ])}
        style={line}
        markerStart={start === null ? undefined : `url(#${base}-start)`}
        markerEnd={end === null ? undefined : `url(#${base}-end)`}
      />
    </svg>
  );
}
