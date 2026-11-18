// The built-in views' svg-surface leaves (ADR-0056 item 1, FR-EXP-004): a shape's outline (rounded, its stroke centred, inside or
// outside, its decorations) in literal paint, with its label laid out in its text region; a text element's text in its box; a group,
// which draws nothing of its own. Each draws in its box's own coordinates, as the html leaf does. What this surface does not draw
// yet (an image fill, artwork, effects, table regions: M20.40) is reported, not rasterized.
import { fitShapeText, type ShapeDef, shrinksText, TEXT_FIT_DEFAULTS, type TextMeasurer, textRegion } from '@fluxion/core';
import { roundCorners } from '@fluxion/geometry';
import type { ShapeElement, TextElement } from '@fluxion/schema';
import { resolveStyle, type Theme } from '@fluxion/theme';
import { type ReactNode, useId } from 'react';
import { concreteLength } from './css-values.js';
import { plainParagraphs } from './label.js';
import { pathData, segmentsData } from './path-data.js';
import type { ElementViewProps } from './registries.js';
import { styledBlocks } from './rich-layout.js';
import { useOutline } from './shape-outline.js';
import { viewStyle } from './shape-style.js';
import { opacityOf, strokeAttrs, svgPaint } from './svg-paint.js';
import { SvgPlaceholder, useSvgMeasurer, useSvgReport } from './svg-surface.js';
import { SvgLabel } from './svg-text.js';
import { concreteFont } from './text-measurer.js';

/** Where an outside stroke's mask reaches: far beyond any box, so the outside half always shows. */
const EDGE_AREA = { x: -1e4, y: -1e4, width: 2e4, height: 2e4 };

/** The outline and its stroke where the style puts it (ADR-0019): centred, inside (doubled, clipped) or outside (doubled, masked). */
function SvgOutline(props: {
  readonly d: string;
  readonly fill: string;
  readonly stroke: ReturnType<typeof strokeAttrs>;
  readonly align: string;
  readonly ids: string;
  readonly fillRule?: 'nonzero' | 'evenodd' | undefined;
}): ReactNode {
  const { d, fill, stroke, align, ids, fillRule } = props;
  if (align !== 'inside' && align !== 'outside') return <path d={d} fill={fill} fillRule={fillRule} {...stroke} />;
  const doubled = { ...stroke, strokeWidth: stroke.strokeWidth * 2 };
  const inside = align === 'inside';
  return (
    <>
      {inside ? (
        <clipPath id={`fx-clip-${ids}`}>
          <path d={d} clipRule={fillRule} />
        </clipPath>
      ) : (
        <mask id={`fx-edge-${ids}`} maskUnits="userSpaceOnUse" {...EDGE_AREA}>
          <rect {...EDGE_AREA} fill="#ffffff" />
          <path d={d} fill="#000000" fillRule={fillRule} />
        </mask>
      )}
      <path d={d} fill={fill} fillRule={fillRule} stroke="none" />
      <path d={d} fill="none" {...doubled} clipPath={inside ? `url(#fx-clip-${ids})` : undefined} mask={inside ? undefined : `url(#fx-edge-${ids})`} />
    </>
  );
}

/** What of a shape's style this surface does not draw yet, as findings. */
function unsupported(style: ReturnType<typeof viewStyle>, artwork: boolean): string[] {
  return [
    ...(style.fill.type === 'image' ? ['an image fill'] : []),
    ...(artwork ? ['artwork'] : []),
    ...(style.shadows.length + style.effects.length > 0 ? ['effects'] : []),
  ];
}

/** Where a shape's label goes: its definition's text region with the fit's padding, at the size a shrink fit chose. */
function shapeLabel(element: ShapeElement, def: ShapeDef, style: ReturnType<typeof viewStyle>, at: { readonly theme: Theme; readonly measurer: TextMeasurer }) {
  const { theme, measurer } = at;
  const { w, h } = element.transform;
  const region = textRegion(def, { w, h }, element.params);
  const box = region.ok ? region.value : { x: 0, y: 0, w, h };
  const padding = element.textFit?.padding ?? TEXT_FIT_DEFAULTS.padding;
  const paragraphs = plainParagraphs(element.text);
  if (!shrinksText(element.textFit) || paragraphs.length === 0) return { box: { ...box, padding }, size: undefined };
  const font = concreteFont(style.font, theme);
  const fitted = fitShapeText(
    { def, size: { w, h }, params: element.params, paragraphs, blocks: styledBlocks(element.text, theme), font, fit: element.textFit },
    measurer,
  );
  return { box: { ...box, padding }, size: fitted.ok ? fitted.value.size : undefined };
}

/**
 * The svg-surface view of `kind: 'shape'` elements.
 *
 * @public
 */
export function ShapeSvg(props: ElementViewProps): ReactNode {
  const { theme, registries } = props;
  const element = props.element as ShapeElement;
  const ids = useId().replace(/[^\w-]/g, '');
  const report = useSvgReport();
  const measurer = useSvgMeasurer();
  const def = registries.shapeDefs.get(element.defId);
  const { w, h } = element.transform;
  const outlined = useOutline(def, element, { w, h });
  if (def === undefined || outlined === undefined || !outlined.ok) return <SvgPlaceholder {...props} />;
  const style = viewStyle(element, def, theme);
  for (const what of unsupported(style, def.artwork !== undefined))
    report({ code: 'FLX_EXPORT_UNSUPPORTED', elementId: element.id, message: `${what} is not drawn on the svg surface yet` });
  const closed = outlined.value.path.closed;
  const { fill, defs } = closed ? svgPaint(style.fill, `fx-fill-${ids}`, { w, h }, theme) : { fill: 'none', defs: undefined };
  const radius = concreteLength(style.radius, theme);
  const drawn = closed && radius > 0 && outlined.fillRule === undefined ? roundCorners(outlined.value.commands, radius) : outlined.value.commands;
  const stroke = strokeAttrs(style.stroke, theme);
  const opacity = opacityOf(style.opacity, theme);
  const label = shapeLabel(element, def, style, { theme, measurer });
  return (
    <g opacity={opacity === 1 ? undefined : opacity}>
      {defs === undefined ? null : <defs>{defs}</defs>}
      <SvgOutline d={pathData(drawn)} fill={fill} stroke={stroke} align={closed ? style.stroke.align : 'center'} ids={ids} fillRule={outlined.fillRule} />
      {outlined.value.decorations.map((d, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: decorations have stable definition order
        <path key={k} d={segmentsData(d)} fill="none" {...stroke} />
      ))}
      <SvgLabel doc={element.text} font={style.font} opacity="1" box={label.box} theme={theme} measurer={measurer} size={label.size} />
    </g>
  );
}

/**
 * The svg-surface view of `kind: 'text'` elements: its text in its whole box.
 *
 * @public
 */
export function TextSvg(props: ElementViewProps): ReactNode {
  const { theme } = props;
  const element = props.element as TextElement;
  const measurer = useSvgMeasurer();
  const { style } = resolveStyle(element.style, 'text', theme, ['records', element.id, 'style']);
  const { w, h } = element.transform;
  return <SvgLabel doc={element.text} font={style.font} opacity={style.opacity} box={{ x: 0, y: 0, w, h, padding: 0 }} theme={theme} measurer={measurer} />;
}

/**
 * The svg-surface view of `kind: 'group'` elements: nothing of its own; its members draw beside it.
 *
 * @public
 */
export function GroupSvg(): ReactNode {
  return null;
}
