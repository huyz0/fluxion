// The shape view (FR-SHP-001, ADR-0015 §5, ADR-0016): the element's `defId` looked up in the
// `shapeDefs` registry, its outline evaluated for the element's size and params and drawn as an SVG
// path filling the wrapper's box, filled and stroked with the resolved style; its text is a centred
// plain-text label. An unknown `defId`, or an outline that does not evaluate, renders the placeholder.
import { evaluateOutline } from '@fluxion/core';
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

/** Rounded to 1/1000 px, like path data, so the markup is stable across platforms. */
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/**
 * The SVG fill of `paint` on a `w` × `h` box: a colour, or a gradient defined next to the path.
 * Gradients follow CSS (M4.30), so a paint looks the same on a shape as on a screen background
 * (background.ts): a linear gradient runs through the centre at the paint's angle (0° left to right,
 * clockwise) over the CSS gradient-line length, so the corners sit at 0 % and 100 %; a radial one is
 * a farthest-corner circle. Images arrive in M10.
 */
function svgFill(paint: ResolvedPaint, id: string, w: number, h: number): { readonly fill: string; readonly defs?: ReactNode } {
  switch (paint.type) {
    case 'color':
      return { fill: paint.css };
    case 'linear-gradient': {
      const a = (paint.angle * Math.PI) / 180;
      const [cos, sin] = [Math.cos(a), Math.sin(a)];
      const half = (Math.abs(w * cos) + Math.abs(h * sin)) / 2;
      const defs = (
        <linearGradient
          id={id}
          gradientUnits="userSpaceOnUse"
          x1={r3(w / 2 - half * cos)}
          y1={r3(h / 2 - half * sin)}
          x2={r3(w / 2 + half * cos)}
          y2={r3(h / 2 + half * sin)}
        >
          {stops(paint)}
        </linearGradient>
      );
      return { fill: `url(#${id})`, defs };
    }
    case 'radial-gradient': {
      const defs = (
        <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={r3(w / 2)} cy={r3(h / 2)} r={r3(Math.hypot(w, h) / 2)}>
          {stops(paint)}
        </radialGradient>
      );
      return { fill: `url(#${id})`, defs };
    }
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
  const def = registries.shapeDefs.get(element.defId);
  const { style } = useMemo(() => {
    // the definition's defaults sit under the element's style (02 §2)
    const defaults = def?.defaultStyle;
    const of = defaults === undefined ? 'shape' : { kind: 'shape', defaults, defaultsAt: ['shapeDefs', element.defId, 'defaultStyle'] };
    return resolveStyle(element.style, of, theme, ['records', id, 'style']);
  }, [element.style, element.defId, def, theme, id]);
  const { w, h } = element.transform;
  const outlined = useMemo(() => (def === undefined ? undefined : evaluateOutline(def, { w, h }, element.params)), [def, w, h, element.params]);
  if (outlined === undefined || !outlined.ok) return <PlaceholderView {...props} />;
  // an open outline is a stroke: it has no inside to fill (ADR-0016 item 2)
  const { fill, defs } = outlined.value.path.closed ? svgFill(style.fill, fillId, w, h) : { fill: 'none', defs: undefined };
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
        <path className="fx-outline" d={pathData(outlined.value.commands)} style={outline} />
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
