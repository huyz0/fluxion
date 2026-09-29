// The shape view (FR-SHP-001, ADR-0015 §5, ADR-0016): the element's `defId` looked up in the
// `shapeDefs` registry, its outline evaluated for the element's size and params and drawn as an SVG
// path filling the wrapper's box, filled and stroked with the resolved style; its text is a centred
// plain-text label. An unknown `defId`, or an outline that does not evaluate, renders the placeholder.

import { evaluateOutline, fitShapeText, type ShapeDef, shrinksText, TEXT_FIT_DEFAULTS, type TextMeasurer, textRegion } from '@fluxion/core';
import { roundCorners } from '@fluxion/geometry';
import type { ShapeElement } from '@fluxion/schema';
import { type ResolvedFont, type ResolvedPaint, resolveStyle, type Theme } from '@fluxion/theme';
import { type CSSProperties, type ReactNode, useContext, useId, useMemo } from 'react';
import { type ImageSource, useImage } from './assets.js';
import { PlaceholderView } from './elements.js';
import { plainParagraphs } from './label.js';
import { pathData, segmentsData } from './path-data.js';
import type { ElementViewProps } from './registries.js';
import { browserMeasurer, concreteFont, concreteLength, MeasurerContext, useFontGeneration } from './text-measurer.js';

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
 * a farthest-corner circle. An image fills through a pattern (`imageFill`).
 */
function svgFill(
  paint: ResolvedPaint,
  id: string,
  box: { readonly w: number; readonly h: number },
  image: ImageSource | undefined,
): { readonly fill: string; readonly defs?: ReactNode } {
  const { w, h } = box;
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
    case 'image':
      return imageFill(paint, id, box, image);
    default:
      return { fill: 'none' };
  }
}

/** How `cover`, `contain` and `fill` fit an image into the box (CSS object-fit, as SVG preserveAspectRatio). */
const ASPECT: { readonly [fit: string]: string } = { cover: 'xMidYMid slice', contain: 'xMidYMid meet', fill: 'none' };
/** The tile size of an image whose asset records no natural size. */
const TILE = 64;

/**
 * An image paint as an SVG pattern: fitted to the box, or repeated at its natural size (`tile`, the
 * pattern fill). An image the host cannot draw fills nothing.
 */
function imageFill(
  paint: Extract<ResolvedPaint, { type: 'image' }>,
  id: string,
  box: { readonly w: number; readonly h: number },
  src: ImageSource | undefined,
): { readonly fill: string; readonly defs?: ReactNode } {
  if (src === undefined) return { fill: 'none' };
  const tile = paint.fit === 'tile';
  const [w, h] = tile ? [src.w ?? TILE, src.h ?? TILE] : [box.w, box.h];
  const defs = (
    <pattern id={id} patternUnits="userSpaceOnUse" width={r3(w)} height={r3(h)}>
      <image href={src.href} width={r3(w)} height={r3(h)} preserveAspectRatio={tile ? 'none' : (ASPECT[paint.fit] ?? 'xMidYMid slice')} />
    </pattern>
  );
  return { fill: `url(#${id})`, defs };
}

const JUSTIFY: { readonly [align: string]: string } = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

/**
 * Where and how a shape's text is laid out (ADR-0018, FR-SHP-006): its definition's text region, the
 * `textFit` padding and overflow, and for `shrink` the largest size that fits (measured; without a
 * measurer, as in server rendering, the styled size).
 */
function textBox(
  input: { readonly element: ShapeElement; readonly def: ShapeDef; readonly paragraphs: readonly string[]; readonly font: ResolvedFont; readonly theme: Theme },
  measurer: TextMeasurer | undefined,
): CSSProperties {
  const { element, def, paragraphs } = input;
  const size = { w: element.transform.w, h: element.transform.h };
  const fit = element.textFit;
  const found = textRegion(def, size, element.params);
  const region = found.ok ? found.value : { x: 0, y: 0, ...size };
  const box: CSSProperties = {
    left: region.x,
    top: region.y,
    width: region.w,
    height: region.h,
    padding: fit?.padding ?? TEXT_FIT_DEFAULTS.padding,
    overflow: fit?.overflow === 'clip' ? 'hidden' : 'visible',
  };
  if (!shrinksText(fit) || measurer === undefined || paragraphs.length === 0) return box;
  const fitted = fitShapeText({ def, size, params: element.params, paragraphs, font: concreteFont(input.font, input.theme), fit }, measurer);
  return fitted.ok ? { ...box, fontSize: fitted.value.size } : box;
}

/** Where an outside stroke's mask reaches: far beyond any box, so the outside half always shows. */
const EDGE_AREA = { x: -1e4, y: -1e4, width: 2e4, height: 2e4 };

/**
 * The outline with its stroke where the style puts it (ADR-0019): centred (SVG's own stroke), inside (a
 * stroke of twice the width clipped to the outline) or outside (twice the width with the outline
 * masked out). The fill is drawn by the `fx-outline` path in every case.
 */
function Outline(props: {
  readonly d: string;
  readonly fill: string;
  readonly stroke: CSSProperties;
  readonly align: string;
  readonly ids: string;
}): ReactNode {
  const { d, fill, stroke, align, ids } = props;
  if (align !== 'inside' && align !== 'outside') return <path className="fx-outline" d={d} style={{ fill, ...stroke }} />;
  const doubled: CSSProperties = { ...stroke, fill: 'none', strokeWidth: `calc(${String(stroke.strokeWidth)} * 2)` };
  const inside = align === 'inside';
  return (
    <>
      {inside ? (
        <clipPath id={`fx-clip-${ids}`}>
          <path d={d} />
        </clipPath>
      ) : (
        <mask id={`fx-edge-${ids}`} maskUnits="userSpaceOnUse" {...EDGE_AREA}>
          <rect {...EDGE_AREA} fill="white" />
          <path d={d} fill="black" />
        </mask>
      )}
      <path className="fx-outline" d={d} style={{ fill, stroke: 'none' }} />
      <path
        className="fx-stroke"
        d={d}
        style={doubled}
        clipPath={inside ? `url(#fx-clip-${ids})` : undefined}
        mask={inside ? undefined : `url(#fx-edge-${ids})`}
      />
    </>
  );
}

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
  const { theme, registries, store } = props;
  const element = props.element as ShapeElement;
  const { id } = element;
  // unique per mounted view: one record may be drawn twice on a page (a thumbnail beside the main view)
  const ids = useId().replace(/[^\w-]/g, '');
  const fillId = `fx-fill-${ids}`;
  const def = registries.shapeDefs.get(element.defId);
  const { style } = useMemo(() => {
    // the definition's defaults sit under the element's style (02 §2)
    const defaults = def?.defaultStyle;
    const of = defaults === undefined ? 'shape' : { kind: 'shape', defaults, defaultsAt: ['shapeDefs', element.defId, 'defaultStyle'] };
    return resolveStyle(element.style, of, theme, ['records', id, 'style']);
  }, [element.style, element.defId, def, theme, id]);
  const image = useImage(store, style.fill.type === 'image' ? style.fill.assetId : undefined);
  const measurer = useContext(MeasurerContext) ?? browserMeasurer();
  const fonts = useFontGeneration();
  const { w, h } = element.transform;
  const outlined = useMemo(() => (def === undefined ? undefined : evaluateOutline(def, { w, h }, element.params)), [def, w, h, element.params]);
  const paragraphs = useMemo(() => plainParagraphs(element.text), [element.text]);
  // laid out once per change of what it depends on (M5.14 review F3); again when fonts load
  // biome-ignore lint/correctness/useExhaustiveDependencies: fonts is the re-measure signal
  const text = useMemo(
    () => (def === undefined ? {} : textBox({ element, def, paragraphs, font: style.font, theme }, measurer)),
    [element, def, paragraphs, style.font, theme, measurer, fonts],
  );
  if (outlined === undefined || !outlined.ok) return <PlaceholderView {...props} />;
  // an open outline is a stroke: it has no inside to fill (ADR-0016 item 2)
  const { fill, defs } = outlined.value.path.closed ? svgFill(style.fill, fillId, { w, h }, image) : { fill: 'none', defs: undefined };
  const stroke: CSSProperties = {
    stroke: style.stroke.color,
    strokeWidth: style.stroke.width,
    strokeLinecap: style.stroke.cap as CSSProperties['strokeLinecap'],
    strokeLinejoin: style.stroke.join as CSSProperties['strokeLinejoin'],
    ...(style.stroke.dash === undefined ? {} : { strokeDasharray: style.stroke.dash }),
  };
  // a style's corner radius rounds the drawn outline's straight corners (ADR-0019)
  const radius = concreteLength(style.radius, theme);
  const closed = outlined.value.path.closed;
  const drawn = closed && radius > 0 ? roundCorners(outlined.value.commands, radius) : outlined.value.commands;
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ opacity: style.opacity }}>
        {defs === undefined ? null : <defs>{defs}</defs>}
        <Outline d={pathData(drawn)} fill={fill} stroke={stroke} align={closed ? style.stroke.align : 'center'} ids={ids} />
        {outlined.value.decorations.map((d, k) => (
          // decorations are strokes over the outline (ADR-0016 item 3), in definition order
          // biome-ignore lint/suspicious/noArrayIndexKey: a definition's decorations have no identity but their order
          <path key={k} className="fx-decoration" d={segmentsData(d)} style={{ fill: 'none', ...stroke }} />
        ))}
      </svg>
      {paragraphs.length === 0 ? null : (
        <div className="fx-label" style={{ ...labelStyle(style.font, style.opacity), ...text }}>
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
