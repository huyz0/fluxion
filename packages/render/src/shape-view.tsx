// The shape view (FR-SHP-001, ADR-0015 §5): the outline of the element's `defId`, looked up in the
// `shapeDefs` registry, drawn as an SVG path filling the wrapper's box, filled and stroked with the
// resolved style; its text is a centred plain-text label. An unknown `defId` renders the placeholder.
import type { ShapeElement } from '@fluxion/schema';
import { type ResolvedFont, type ResolvedPaint, resolveStyle } from '@fluxion/theme';
import { type CSSProperties, type ReactNode, useId, useMemo } from 'react';
import { PlaceholderView } from './elements.js';
import { plainParagraphs } from './label.js';
import { pathData } from './path-data.js';
import type { ElementViewProps } from './registries.js';

const stops = (paint: { readonly stops: ReadonlyArray<{ readonly offset: number; readonly css: string }> }) =>
  // stops may share an offset (a hard stop), so their position is their key; the theme sorts them
  // biome-ignore lint/suspicious/noArrayIndexKey: see above
  paint.stops.map((s, i) => <stop key={i} offset={s.offset} style={{ stopColor: s.css }} />);

/** The SVG fill of `paint`: a colour, or a gradient defined next to the path. Images arrive in M10. */
function svgFill(paint: ResolvedPaint, id: string): { readonly fill: string; readonly defs?: ReactNode } {
  switch (paint.type) {
    case 'color':
      return { fill: paint.css };
    case 'linear-gradient': {
      // the document's 0° runs left to right, clockwise, across the bounding box
      const a = (paint.angle * Math.PI) / 180;
      const [dx, dy] = [Math.cos(a) / 2, Math.sin(a) / 2];
      const defs = (
        <linearGradient id={id} x1={0.5 - dx} y1={0.5 - dy} x2={0.5 + dx} y2={0.5 + dy}>
          {stops(paint)}
        </linearGradient>
      );
      return { fill: `url(#${id})`, defs };
    }
    case 'radial-gradient':
      return { fill: `url(#${id})`, defs: <radialGradient id={id}>{stops(paint)}</radialGradient> };
    default:
      return { fill: 'none' };
  }
}

const JUSTIFY: { readonly [align: string]: string } = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

function labelStyle(font: ResolvedFont, opacity: string): CSSProperties {
  return {
    fontFamily: font.family,
    fontSize: font.size,
    fontWeight: font.weight as CSSProperties['fontWeight'],
    fontStyle: font.style,
    lineHeight: font.lineHeight,
    color: font.color,
    textAlign: font.align as CSSProperties['textAlign'],
    justifyContent: JUSTIFY[font.verticalAlign] ?? 'center',
    opacity,
  };
}

/**
 * The view of `kind: 'shape'` elements.
 *
 * @public
 */
export function ShapeView(props: ElementViewProps): ReactNode {
  const { theme, registries } = props;
  const element = props.element as ShapeElement;
  const { id } = element;
  // unique per mounted view: one record may be drawn twice on a page (a thumbnail beside the main view)
  const fillId = `fx-fill-${useId().replace(/[^\w-]/g, '')}`;
  const { style } = useMemo(() => resolveStyle(element.style, 'shape', theme, ['records', id, 'style']), [element.style, theme, id]);
  const def = registries.shapeDefs.get(element.defId);
  if (def === undefined) return <PlaceholderView {...props} />;
  const { w, h } = element.transform;
  const { fill, defs } = svgFill(style.fill, fillId);
  const paragraphs = plainParagraphs(element.text);
  const outline: CSSProperties = {
    fill,
    stroke: style.stroke.color,
    strokeWidth: style.stroke.width,
    strokeLinecap: style.stroke.cap as CSSProperties['strokeLinecap'],
    strokeLinejoin: style.stroke.join as CSSProperties['strokeLinejoin'],
    ...(style.stroke.dash === undefined ? {} : { strokeDasharray: style.stroke.dash }),
  };
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ opacity: style.opacity }}>
        {defs === undefined ? null : <defs>{defs}</defs>}
        <path className="fx-outline" d={pathData(def.outline({ w, h }))} style={outline} />
      </svg>
      {paragraphs.length === 0 ? null : (
        <div className="fx-label" style={labelStyle(style.font, style.opacity)}>
          {paragraphs.map((text, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no identity; their position is their key
            <p key={i}>{text}</p>
          ))}
        </div>
      )}
      {props.children}
    </>
  );
}
