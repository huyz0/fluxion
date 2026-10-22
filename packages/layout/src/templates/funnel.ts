// The funnel template (FR-LAY-014, ADR-0047): the items as stacked bars, centred, each narrower than the one above, from the top's width
// (the frame's, at most 1.6 times the funnel's height) to `narrowest` of it at the bottom, so the stages read as a funnel. The bars share the frame's height (the gap gives way
// before they go below the minimum), and never get narrower than the longest label needs (nor wider than the frame).
import { z } from 'zod';
import { colorsSchema, commonSize, detailOf, halfBox, inset, itemsSchema, MIN_SIZE, shapeStyle } from './slot-sizing.js';
import type { TemplateContext, TemplateDef, TemplateItem, TemplateResult } from './types.js';

/**
 * Options of `funnel`.
 *
 * @public
 */
export type FunnelOptions = {
  /** Space between stages, px (default 8). */
  readonly gap: number;
  /** The bottom stage's width as a share of the top's, 0.1 to 1 (default 0.4). */
  readonly narrowest: number;
  /** Space between the frame's edge and the funnel, px (default 40). */
  readonly padding: number;
  /** The colour scheme (default `colorful`). */
  readonly colors: 'colorful' | 'primary' | 'outline';
};

const MAX_STAGES = 8;

/** The top stage is at most this many times as wide as the funnel is tall, so a wide frame does not flatten it. */
const MAX_ASPECT = 1.6;

const schema = z
  .strictObject({
    gap: z.number().finite().min(0).default(8),
    narrowest: z.number().finite().min(0.1).max(1).default(0.4),
    padding: z.number().finite().min(0).default(40),
    colors: colorsSchema.default('colorful'),
  })
  .default({ gap: 8, narrowest: 0.4, padding: 40, colors: 'colorful' });

function build(items: readonly TemplateItem[], o: FunnelOptions, ctx: TemplateContext): TemplateResult {
  const area = inset(ctx.frame, o.padding);
  const n = items.length;
  const need = commonSize(items, ctx);
  const gap = n < 2 ? o.gap : Math.min(o.gap, Math.max(0, (area.h - MIN_SIZE.h * n) / (n - 1)));
  const h = Math.max(MIN_SIZE.h, (area.h - gap * (n - 1)) / n);
  const height = h * n + gap * (n - 1);
  const top = Math.min(area.w, height * MAX_ASPECT);
  const centre = area.x + area.w / 2;
  const shapes = items.map((item, i) => {
    const w = Math.min(area.w, Math.max(need.w, top * (1 - ((1 - o.narrowest) * i) / Math.max(1, n - 1))));
    return {
      key: `stage-${i}`,
      slot: 'stage',
      index: i,
      shape: 'basic:rounded-rect',
      box: halfBox({ x: centre - w / 2, y: area.y + (area.h - height) / 2 + i * (h + gap), w, h }),
      label: item.label,
      ...detailOf(item),
      style: shapeStyle('stage', i, o.colors),
    };
  });
  return { shapes, connectors: [] };
}

/**
 * `funnel`: stages narrowing from top to bottom.
 *
 * @public
 */
export const funnelTemplate: TemplateDef<FunnelOptions> = {
  id: 'funnel',
  describe: 'A funnel: stages as bars narrowing from top to bottom, for conversion or filtering steps.',
  version: '1',
  items: itemsSchema(2, MAX_STAGES),
  schema,
  slots: { stage: { shape: 'basic:rounded-rect', role: 'stage' } },
  build,
};
