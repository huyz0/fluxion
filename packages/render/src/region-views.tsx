// A shape's other text regions and its icon slots (FR-SHP-007, ADR-0054, M19.17). The first text region draws the element's
// `text` (shape-view.tsx); each further region of the definition draws `texts[region]` in its own label box, and each icon slot
// draws `icons[slot]`: another definition's outline in the text colour, or an image asset. A `texts` key naming the first region
// is not drawn (`text` wins; the problems panel reports it).

import type { Store } from '@fluxion/core';
import { namedBoxes, type ShapeDef, TEXT_FIT_DEFAULTS } from '@fluxion/core';
import type { RichTextDoc, ShapeElement } from '@fluxion/schema';
import type { ResolvedFont } from '@fluxion/theme';
import type { ReactNode } from 'react';
import { useImage } from './assets.js';
import { labelStyle, plainParagraphs } from './label.js';
import { pathData } from './path-data.js';
import { RichText } from './rich-text.js';
import { outlineOf } from './shape-style.js';

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** Whether `doc` holds any text to draw. */
const written = (doc: RichTextDoc | undefined): doc is RichTextDoc => doc !== undefined && plainParagraphs(doc).some((p) => p.trim() !== '');

/**
 * The labels of the text regions after the first, each `data-region` named, drawn only where the element holds text for it.
 */
export function RegionLabels(props: {
  readonly element: ShapeElement;
  readonly def: ShapeDef;
  readonly font: ResolvedFont;
  readonly opacity: string;
}): ReactNode {
  const { element, def, font, opacity } = props;
  const texts = element.texts;
  if (texts === undefined) return null;
  const regions = namedBoxes(def, { w: element.transform.w, h: element.transform.h }, 'textRegions', element.params).slice(1);
  return regions.map((r) => {
    const doc = texts[r.name];
    if (!written(doc)) return null;
    return (
      <div
        key={r.name}
        className="fx-label fx-region"
        data-region={r.name}
        style={{ ...labelStyle(font, opacity), left: r.x, top: r.y, width: r.w, height: r.h, padding: element.textFit?.padding ?? TEXT_FIT_DEFAULTS.padding }}
      >
        <RichText doc={doc} />
      </div>
    );
  });
}

/** One icon slot: a definition's outline at the slot's size, filled (closed) or stroked (open) in `color`; or an image. */
function IconSlot(props: {
  readonly name: string;
  readonly box: Box;
  readonly fill: { readonly defId: string } | { readonly assetId: string };
  readonly shapeDefs: { get(id: string): ShapeDef | undefined };
  readonly store: Store;
  readonly color: string;
}): ReactNode {
  const { name, box, fill, shapeDefs, store, color } = props;
  const image = useImage(store, 'assetId' in fill ? fill.assetId : undefined);
  const def = 'defId' in fill ? shapeDefs.get(fill.defId) : undefined;
  const outline = def === undefined ? undefined : outlineOf(def, { w: box.w, h: box.h }, {});
  const style = { position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h } as const;
  if (image !== undefined)
    return (
      <svg className="fx-icon-slot" data-slot={name} viewBox={`0 0 ${box.w} ${box.h}`} style={style} aria-hidden="true">
        <image href={image.href} width={box.w} height={box.h} preserveAspectRatio="xMidYMid meet" />
      </svg>
    );
  if (outline === undefined || !outline.ok) return null;
  const closed = outline.value.path.closed;
  return (
    <svg className="fx-icon-slot" data-slot={name} viewBox={`0 0 ${box.w} ${box.h}`} style={style} aria-hidden="true">
      <path d={pathData(outline.value.commands)} style={closed ? { fill: color } : { fill: 'none', stroke: color, strokeWidth: 2 }} />
    </svg>
  );
}

/**
 * The element's filled icon slots, each `data-slot` named; a slot the element does not fill draws nothing.
 */
export function IconSlots(props: {
  readonly element: ShapeElement;
  readonly def: ShapeDef;
  readonly shapeDefs: { get(id: string): ShapeDef | undefined };
  readonly store: Store;
  readonly color: string;
}): ReactNode {
  const { element, def, shapeDefs, store, color } = props;
  const icons = element.icons;
  if (icons === undefined) return null;
  return namedBoxes(def, { w: element.transform.w, h: element.transform.h }, 'iconSlots', element.params).map((slot) => {
    const fill = icons[slot.name];
    return fill === undefined ? null : <IconSlot key={slot.name} name={slot.name} box={slot} fill={fill} shapeDefs={shapeDefs} store={store} color={color} />;
  });
}

/** A shape's text regions after the first and its icon slots, the icons in the text colour; nothing without a definition. */
export function RegionsAndSlots(props: {
  readonly element: ShapeElement;
  readonly def: ShapeDef | undefined;
  readonly font: ResolvedFont;
  readonly opacity: string;
  readonly shapeDefs: { get(id: string): ShapeDef | undefined };
  readonly store: Store;
}): ReactNode {
  const { element, def, font, opacity, shapeDefs, store } = props;
  if (def === undefined) return null;
  return (
    <>
      <RegionLabels element={element} def={def} font={font} opacity={opacity} />
      <IconSlots element={element} def={def} shapeDefs={shapeDefs} store={store} color={font.color} />
    </>
  );
}
