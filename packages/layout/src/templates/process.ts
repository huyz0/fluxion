// The process templates (FR-LAY-014, ADR-0047): the items as steps in a row, at one size that fits the longest label, centred in the frame.
// `process.basic` draws boxes joined by arrows and runs right or down (a portrait frame turns right into down); `process.chevron` draws
// block arrows that point to the next step, always to the right.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { colorsSchema, commonSize, connectorStyle, detailOf, half, halfBox, inset, itemsSchema, MIN_SIZE, shapeStyle } from './slot-sizing.js';
import type { TemplateContext, TemplateDef, TemplateItem, TemplateResult, TemplateShapeDraft } from './types.js';

/**
 * Options of `process.basic`.
 *
 * @public
 */
export type ProcessOptions = {
  /** Which way the steps run (default `right`). */
  readonly direction: 'right' | 'down';
  /** Space between steps, px (default 48). */
  readonly gap: number;
  /** Space between the frame's edge and the steps, px (default 40). */
  readonly padding: number;
  /** The colour scheme (default `colorful`). */
  readonly colors: 'colorful' | 'primary' | 'outline';
};

/**
 * Options of `process.chevron`.
 *
 * @public
 */
export type ChevronOptions = Omit<ProcessOptions, 'direction'>;

const MAX_STEPS = 12;

/**
 * The boxes of `n` steps of `size` along `direction`, centred in `area`; steps shrink along the row, never below the minimum, to fit it,
 * and then the gap shrinks, so as many steps as a template takes fit the row of a 16:9 screen.
 */
function row(n: number, size: { w: number; h: number }, options: Pick<ProcessOptions, 'direction' | 'gap'>, area: Box): Box[] {
  const { direction } = options;
  const along = direction === 'right' ? 'w' : 'h';
  const across = direction === 'right' ? 'h' : 'w';
  const gap = n < 2 ? options.gap : Math.min(options.gap, Math.max(0, (area[along] - MIN_SIZE[along] * n) / (n - 1)));
  const fitted = { ...size };
  fitted[along] = Math.max(MIN_SIZE[along], Math.min(size[along], (area[along] - gap * (n - 1)) / n));
  fitted[across] = Math.max(MIN_SIZE[across], Math.min(size[across], area[across]));
  const length = fitted[along] * n + gap * (n - 1);
  const start = {
    x: area.x + (area.w - (direction === 'right' ? length : fitted.w)) / 2,
    y: area.y + (area.h - (direction === 'down' ? length : fitted.h)) / 2,
  };
  return Array.from({ length: n }, (_, i) =>
    halfBox({
      x: start.x + (direction === 'right' ? i * (fitted.w + gap) : 0),
      y: start.y + (direction === 'down' ? i * (fitted.h + gap) : 0),
      w: fitted.w,
      h: fitted.h,
    }),
  );
}

const options = (gap: number) => ({
  gap: z.number().finite().min(0).default(gap),
  padding: z.number().finite().min(0).default(40),
  colors: colorsSchema.default('colorful'),
});

const processSchema = z
  .strictObject({ direction: z.enum(['right', 'down']).default('right'), ...options(48) })
  .default({ direction: 'right', gap: 48, padding: 40, colors: 'colorful' });
const chevronSchema = z.strictObject(options(8)).default({ gap: 8, padding: 40, colors: 'colorful' });

/** A step's shape: its id and, for the chevron, its parameters. */
type StepShape = { readonly id: string; readonly params?: { readonly [name: string]: number } };

function steps(items: readonly TemplateItem[], boxes: readonly Box[], { id: shape, params }: StepShape, o: ChevronOptions): TemplateShapeDraft[] {
  return items.map((item, i) => ({
    key: `step-${i}`,
    slot: 'step',
    index: i,
    shape,
    box: boxes[i] as Box,
    ...(params ? { params } : {}),
    label: item.label,
    ...detailOf(item),
    style: shapeStyle('step', i, o.colors),
  }));
}

function buildProcess(items: readonly TemplateItem[], o: ProcessOptions, ctx: TemplateContext): TemplateResult {
  const boxes = row(items.length, commonSize(items, ctx), o, inset(ctx.frame, o.padding));
  const connectors = items
    .slice(1)
    .map((_, i) => ({ key: `arrow-${i}`, slot: 'arrow', from: `step-${i}`, to: `step-${i + 1}`, style: connectorStyle('arrow') }));
  return { shapes: steps(items, boxes, { id: 'basic:rounded-rect' }, o), connectors };
}

/** The chevron's head takes this share of its width; the next step starts under it. */
const HEAD = 0.25;
/** The shaft's share of the height: most of it, so the label has room. */
const SHAFT = 0.8;

function buildChevron(items: readonly TemplateItem[], o: ChevronOptions, ctx: TemplateContext): TemplateResult {
  const size = commonSize(items, ctx);
  // the head and the notches hold no text: the arrow is that much larger than its label needs
  const boxes = row(items.length, { w: half(size.w / (1 - HEAD)), h: half(size.h / SHAFT) }, { direction: 'right', gap: o.gap }, inset(ctx.frame, o.padding));
  return { shapes: steps(items, boxes, { id: 'basic:block-arrow', params: { head: HEAD, shaft: SHAFT } }, o), connectors: [] };
}

/**
 * `process.basic`: steps joined by arrows, right or down.
 *
 * @public
 */
export const processBasicTemplate: TemplateDef<ProcessOptions> = {
  id: 'process.basic',
  describe: 'Steps in order joined by arrows, left to right or top to bottom.',
  version: '1',
  items: itemsSchema(1, MAX_STEPS),
  schema: processSchema,
  slots: { step: { shape: 'basic:rounded-rect', role: 'step' }, arrow: { shape: 'connector', role: 'arrow' } },
  build: buildProcess,
  adapt: (frame, o) => (frame.h > frame.w && o.direction === 'right' ? { ...o, direction: 'down' } : o),
};

/**
 * `process.chevron`: steps as arrows that point to the next, left to right.
 *
 * @public
 */
export const processChevronTemplate: TemplateDef<ChevronOptions> = {
  id: 'process.chevron',
  describe: 'Steps in order as chevron arrows pointing to the next, left to right.',
  version: '1',
  items: itemsSchema(1, MAX_STEPS),
  schema: chevronSchema,
  slots: { step: { shape: 'basic:block-arrow', role: 'step' } },
  build: buildChevron,
};
