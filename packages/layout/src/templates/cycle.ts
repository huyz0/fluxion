// The cycle template (FR-LAY-014, ADR-0047): the items as ellipses on a circle, the first at the top, clockwise, each joined by an arrow to
// the next and the last back to the first. One size for all, which fits the longest label unless neighbours would then overlap; the circle
// is as large as the frame allows.
import { z } from 'zod';
import { colorsSchema, commonSize, connectorStyle, detailOf, half, halfBox, inset, itemsSchema, MIN_SIZE, shapeStyle } from './slot-sizing.js';
import type { TemplateContext, TemplateDef, TemplateItem, TemplateResult } from './types.js';

/**
 * Options of `cycle.basic`.
 *
 * @public
 */
export type CycleOptions = {
  /** Space between the frame's edge and the cycle, px (default 40). */
  readonly padding: number;
  /** The colour scheme (default `colorful`). */
  readonly colors: 'colorful' | 'primary' | 'outline';
};

const MAX_ITEMS = 12;

/** An ellipse's label fits the rectangle inscribed in it, which is its box divided by √2. */
const ELLIPSE = Math.SQRT2;

const schema = z
  .strictObject({ padding: z.number().finite().min(0).default(40), colors: colorsSchema.default('colorful') })
  .default({ padding: 40, colors: 'colorful' });

function build(items: readonly TemplateItem[], o: CycleOptions, ctx: TemplateContext): TemplateResult {
  const area = inset(ctx.frame, o.padding);
  const label = commonSize(items, ctx);
  const n = items.length;
  // neighbours sit 2r·sin(π/n) apart, r = (side - size) / 2; at least √2 times the larger side apart, two boxes never overlap (a pixel
  // spare for the half-pixel rounding)
  const k = Math.sin(Math.PI / n);
  const side = Math.min(area.w, area.h);
  const most = Math.max(0, (k * side) / (Math.SQRT2 + k) - 1);
  const size = { w: half(Math.min(Math.max(label.w * ELLIPSE, MIN_SIZE.w), most)), h: half(Math.min(Math.max(label.h * ELLIPSE, MIN_SIZE.h), most)) };
  const centre = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
  const radius = Math.max(0, (side - Math.max(size.w, size.h)) / 2);
  const shapes = items.map((item, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const at = { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
    return {
      key: `item-${i}`,
      slot: 'item',
      index: i,
      shape: 'basic:ellipse',
      box: halfBox({ x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h }),
      label: item.label,
      ...detailOf(item),
      style: shapeStyle('item', i, o.colors),
    };
  });
  const connectors = items.map((_, i) => ({ key: `arrow-${i}`, slot: 'arrow', from: `item-${i}`, to: `item-${(i + 1) % n}`, style: connectorStyle('arrow') }));
  return { shapes, connectors };
}

/**
 * `cycle.basic`: items on a circle, each leading to the next and the last back to the first.
 *
 * @public
 */
export const cycleBasicTemplate: TemplateDef<CycleOptions> = {
  id: 'cycle.basic',
  describe: 'A repeating cycle: items on a circle, clockwise from the top, each arrow leading to the next.',
  version: '1',
  items: itemsSchema(2, MAX_ITEMS),
  schema,
  slots: { item: { shape: 'basic:ellipse', role: 'item' }, arrow: { shape: 'connector', role: 'arrow' } },
  build,
};
