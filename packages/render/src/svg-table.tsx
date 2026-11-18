// The svg-surface leaf of tables and a shape's further text regions and icon slots (ADR-0056 items 3 and 8, FR-EXP-004): each cell a
// rectangle at its place in the grid (a merged cell spans its rows and columns), filled and bordered in the style it resolves, its
// border centred on its edge as the html leaf's outline is, its text laid out in it; each further region's text in its own box and
// each icon slot drawn from another definition's outline in the text colour or from an image's `data:` URL. Colours are literals.
import { namedBoxes, type ShapeDef, type Store, TEXT_FIT_DEFAULTS, type TextMeasurer } from '@fluxion/core';
import type { RichTextDoc, ShapeElement, TableElement } from '@fluxion/schema';
import type { ResolvedFont, Theme } from '@fluxion/theme';
import { type ReactNode, useId } from 'react';
import { plainParagraphs } from './label.js';
import { pathData } from './path-data.js';
import type { ElementViewProps } from './registries.js';
import { outlineOf } from './shape-style.js';
import { lit, n3, opacityOf, strokeAttrs, svgPaint } from './svg-paint.js';
import { useSvgImage, useSvgMeasurer } from './svg-surface.js';
import { SvgLabel } from './svg-text.js';
import { tableCellStyle, tableCells } from './table-layout.js';

/** Space between a cell's edge and its text, px (the html leaf's). */
const CELL_PADDING_PX = 6;

/**
 * The svg-surface view of `kind: 'table'` elements.
 *
 * @public
 */
export function TableSvg(props: ElementViewProps): ReactNode {
  const { theme } = props;
  const table = props.element as TableElement;
  const measurer = useSvgMeasurer();
  const ids = useId().replace(/[^\w-]/g, '');
  const { w, h } = table.transform;
  return (
    <g>
      {tableCells(table, { w, h }).map((box, k) => {
        const cell = table.cells[box.key];
        const style = tableCellStyle(table, box.row, cell?.style, theme);
        const opacity = opacityOf(style.opacity, theme);
        const { fill, defs } = svgPaint(style.fill, `fx-cell-${ids}-${k}`, box, theme);
        return (
          <g key={box.key} opacity={opacity === 1 ? undefined : opacity}>
            {defs === undefined ? null : <defs>{defs}</defs>}
            <rect x={n3(box.x)} y={n3(box.y)} width={n3(box.w)} height={n3(box.h)} fill={fill} {...strokeAttrs(style.stroke, theme)} />
            <SvgLabel doc={cell?.text} font={style.font} opacity="1" box={{ ...box, padding: CELL_PADDING_PX }} theme={theme} measurer={measurer} />
          </g>
        );
      })}
    </g>
  );
}

/** Whether `doc` holds any text to draw. */
const written = (doc: RichTextDoc | undefined): doc is RichTextDoc => doc !== undefined && plainParagraphs(doc).some((p) => p.trim() !== '');

/** One icon slot: a definition's outline filled (closed) or stroked (open) in `color`, or an image fitted into the slot. */
function SvgIconSlot(props: {
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly fill: { readonly defId: string } | { readonly assetId: string };
  readonly shapeDefs: { get(id: string): ShapeDef | undefined };
  readonly store: Store;
  readonly color: string;
  readonly elementId: string;
}): ReactNode {
  const { box, fill, shapeDefs, store, color } = props;
  const image = useSvgImage(store, 'assetId' in fill ? fill.assetId : undefined, props.elementId);
  if (image !== undefined)
    return <image x={n3(box.x)} y={n3(box.y)} width={n3(box.w)} height={n3(box.h)} xlinkHref={image.href} preserveAspectRatio="xMidYMid meet" />;
  const def = 'defId' in fill ? shapeDefs.get(fill.defId) : undefined;
  const outline = def === undefined ? undefined : outlineOf(def, { w: box.w, h: box.h }, {});
  if (outline === undefined || !outline.ok) return null;
  const paint = outline.value.path.closed ? { fill: color } : { fill: 'none', stroke: color, strokeWidth: 2 };
  return <path d={pathData(outline.value.commands)} transform={`translate(${n3(box.x)} ${n3(box.y)})`} {...paint} />;
}

/** A shape's text regions after the first and its filled icon slots, as the html leaf draws them; the icons in the text colour. */
export function SvgRegionsAndSlots(props: {
  readonly element: ShapeElement;
  readonly def: ShapeDef;
  readonly font: ResolvedFont;
  readonly shapeDefs: { get(id: string): ShapeDef | undefined };
  readonly store: Store;
  readonly theme: Theme;
  readonly measurer: TextMeasurer;
}): ReactNode {
  const { element, def, font, theme, measurer } = props;
  const size = { w: element.transform.w, h: element.transform.h };
  const padding = element.textFit?.padding ?? TEXT_FIT_DEFAULTS.padding;
  const texts = element.texts ?? {};
  const icons = element.icons ?? {};
  const color = lit(font.color, theme) || '#000000';
  return (
    <>
      {namedBoxes(def, size, 'textRegions', element.params)
        .slice(1)
        .map((r) => {
          const doc = texts[r.name];
          return written(doc) ? <SvgLabel key={r.name} doc={doc} font={font} opacity="1" box={{ ...r, padding }} theme={theme} measurer={measurer} /> : null;
        })}
      {namedBoxes(def, size, 'iconSlots', element.params).map((slot) => {
        const fill = icons[slot.name];
        return fill === undefined ? null : (
          <SvgIconSlot key={slot.name} box={slot} fill={fill} shapeDefs={props.shapeDefs} store={props.store} color={color} elementId={element.id} />
        );
      })}
    </>
  );
}
