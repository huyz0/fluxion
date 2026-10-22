// The 2 × 2 matrix template (FR-LAY-014, ADR-0047): exactly four items as the quadrants of a square-ish grid, in reading order (top left,
// top right, bottom left, bottom right). The grid fills the frame's height and is at most 1.6 times as wide as it is tall, so a wide frame
// does not stretch the quadrants into bars; never smaller than the labels need.
import { z } from 'zod';
import { colorsSchema, commonSize, detailOf, halfBox, inset, itemsSchema, shapeStyle } from './slot-sizing.js';
import type { TemplateContext, TemplateDef, TemplateItem, TemplateResult } from './types.js';

/**
 * Options of `matrix.2x2`.
 *
 * @public
 */
export type MatrixOptions = {
  /** Space between quadrants, px (default 16). */
  readonly gap: number;
  /** Space between the frame's edge and the grid, px (default 40). */
  readonly padding: number;
  /** The colour scheme (default `colorful`). */
  readonly colors: 'colorful' | 'primary' | 'outline';
};

/** The grid is at most this many times as wide as it is tall. */
const MAX_ASPECT = 1.6;

const schema = z
  .strictObject({
    gap: z.number().finite().min(0).default(16),
    padding: z.number().finite().min(0).default(40),
    colors: colorsSchema.default('colorful'),
  })
  .default({ gap: 16, padding: 40, colors: 'colorful' });

function build(items: readonly TemplateItem[], o: MatrixOptions, ctx: TemplateContext): TemplateResult {
  const area = inset(ctx.frame, o.padding);
  const need = commonSize(items, ctx);
  const h = Math.max(need.h, (area.h - o.gap) / 2);
  const w = Math.max(need.w, (Math.min(area.w, (h * 2 + o.gap) * MAX_ASPECT) - o.gap) / 2);
  const origin = { x: area.x + (area.w - (w * 2 + o.gap)) / 2, y: area.y + (area.h - (h * 2 + o.gap)) / 2 };
  const shapes = items.map((item, i) => ({
    key: `quadrant-${i}`,
    slot: 'quadrant',
    index: i,
    shape: 'basic:rounded-rect',
    box: halfBox({ x: origin.x + (i % 2) * (w + o.gap), y: origin.y + Math.floor(i / 2) * (h + o.gap), w, h }),
    label: item.label,
    ...detailOf(item),
    style: shapeStyle('quadrant', i, o.colors),
  }));
  return { shapes, connectors: [] };
}

/**
 * `matrix.2x2`: four quadrants, in reading order.
 *
 * @public
 */
export const matrix2x2Template: TemplateDef<MatrixOptions> = {
  id: 'matrix.2x2',
  describe: 'A 2 x 2 matrix: exactly four items as quadrants, top left, top right, bottom left, bottom right.',
  version: '1',
  items: itemsSchema(4, 4),
  schema,
  slots: { quadrant: { shape: 'basic:rounded-rect', role: 'quadrant' } },
  build,
};
