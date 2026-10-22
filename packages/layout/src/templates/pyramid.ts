// The pyramid template (FR-LAY-014, ADR-0047): the items as layers of one triangle, the first at the apex. The top layer is a triangle and
// every other a trapezoid whose slanted sides continue the triangle's, so the gaps between layers keep one outline. The layers share the
// frame's height (never below the minimum); the base is as wide as the frame allows, at most 1.6 times the height.
import { z } from 'zod';
import { colorsSchema, detailOf, halfBox, inset, itemsSchema, MIN_SIZE, shapeStyle } from './slot-sizing.js';
import type { TemplateContext, TemplateDef, TemplateItem, TemplateResult } from './types.js';

/**
 * Options of `pyramid`.
 *
 * @public
 */
export type PyramidOptions = {
  /** Space between layers, px (default 8). */
  readonly gap: number;
  /** Space between the frame's edge and the pyramid, px (default 40). */
  readonly padding: number;
  /** The colour scheme (default `colorful`). */
  readonly colors: 'colorful' | 'primary' | 'outline';
};

const MAX_LAYERS = 10;

/** The base is at most this many times as wide as the pyramid is tall, so a wide frame does not flatten it. */
const MAX_ASPECT = 1.6;

const schema = z
  .strictObject({ gap: z.number().finite().min(0).default(8), padding: z.number().finite().min(0).default(40), colors: colorsSchema.default('colorful') })
  .default({ gap: 8, padding: 40, colors: 'colorful' });

function build(items: readonly TemplateItem[], o: PyramidOptions, ctx: TemplateContext): TemplateResult {
  const area = inset(ctx.frame, o.padding);
  const n = items.length;
  // the gap gives way before the layers go below the minimum, so the most layers the template takes fit a 16:9 screen
  const gap = n < 2 ? o.gap : Math.min(o.gap, Math.max(0, (area.h - MIN_SIZE.h * n) / (n - 1)));
  const layer = Math.max(MIN_SIZE.h, (area.h - gap * (n - 1)) / n);
  const height = layer * n + gap * (n - 1);
  const base = Math.min(area.w, height * MAX_ASPECT);
  const top = area.y + (area.h - height) / 2;
  const centre = area.x + area.w / 2;
  // the width of the triangle `y` below the apex
  const widthAt = (y: number): number => (base * y) / height;
  const shapes = items.map((item, i) => {
    const y = i * (layer + gap);
    const w = widthAt(y + layer);
    // the share of the width each slanted side cuts off the top edge; the apex layer is a triangle
    const cut = i === 0 ? undefined : Math.round(((w - widthAt(y)) / 2 / w) * 1000) / 1000;
    return {
      key: `layer-${i}`,
      slot: i === 0 ? 'apex' : 'layer',
      index: i,
      shape: i === 0 ? 'basic:triangle' : 'basic:trapezoid',
      box: halfBox({ x: centre - w / 2, y: top + y, w, h: layer }),
      ...(cut === undefined ? {} : { params: { inset: cut } }),
      label: item.label,
      ...detailOf(item),
      style: shapeStyle('layer', i, o.colors),
    };
  });
  return { shapes, connectors: [] };
}

/**
 * `pyramid`: items as the layers of a pyramid, the first at the apex.
 *
 * @public
 */
export const pyramidTemplate: TemplateDef<PyramidOptions> = {
  id: 'pyramid',
  describe: 'A pyramid of layers, the first item at the apex: foundations at the base, the few at the top.',
  version: '1',
  items: itemsSchema(1, MAX_LAYERS),
  schema,
  slots: { layer: { shape: 'basic:trapezoid', role: 'layer' }, apex: { shape: 'basic:triangle', role: 'layer' } },
  build,
};
