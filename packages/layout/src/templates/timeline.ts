// The milestones timeline template (FR-LAY-014, ADR-0047): a marker per item, evenly spaced along a line through the frame's middle and
// joined in order, each with its label beside it, alternating sides so neighbouring labels have two spacings of room; the first and last
// labels end at the frame's edges. It runs right or down; a portrait frame turns right into down.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { colorsSchema, commonSize, connectorStyle, detailOf, halfBox, inset, itemsSchema, shapeStyle } from './slot-sizing.js';
import type { TemplateConnectorDraft, TemplateContext, TemplateDef, TemplateItem, TemplateResult, TemplateShapeDraft } from './types.js';

/**
 * Options of `timeline.milestones`.
 *
 * @public
 */
export type MilestonesOptions = {
  /** Which way time runs (default `right`). */
  readonly direction: 'right' | 'down';
  /** Space between the frame's edge and the timeline, px (default 40). */
  readonly padding: number;
  /** The colour scheme (default `colorful`). */
  readonly colors: 'colorful' | 'primary' | 'outline';
};

const MAX_MILESTONES = 12;

/** A marker's diameter, px. */
const MARKER = 24;

/** Space between a marker and its label, and between labels on one side, px. */
const SPACE = 16;

const schema = z
  .strictObject({
    direction: z.enum(['right', 'down']).default('right'),
    padding: z.number().finite().min(0).default(40),
    colors: colorsSchema.default('colorful'),
  })
  .default({ direction: 'right', padding: 40, colors: 'colorful' });

/** The marker at `at` on the line and the box of its label, on the side `before` (above or left) or after it. */
function placed(at: { x: number; y: number }, label: { w: number; h: number }, before: boolean, direction: 'right' | 'down'): { marker: Box; label: Box } {
  const marker = { x: at.x - MARKER / 2, y: at.y - MARKER / 2, w: MARKER, h: MARKER };
  const off = MARKER / 2 + SPACE;
  const box =
    direction === 'right'
      ? { x: at.x - label.w / 2, y: before ? at.y - off - label.h : at.y + off, ...label }
      : { x: before ? at.x - off - label.w : at.x + off, y: at.y - label.h / 2, ...label };
  return { marker: halfBox(marker), label: halfBox(box) };
}

function build(items: readonly TemplateItem[], o: MilestonesOptions, ctx: TemplateContext): TemplateResult {
  const area = inset(ctx.frame, o.padding);
  const n = items.length;
  const need = commonSize(items, ctx);
  const across = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
  const right = o.direction === 'right';
  const length = right ? area.w : area.h;
  // labels alternate sides, so one may be as long as two spacings less the space between: with the first and last label's ends at the
  // frame's edges, the spacing is (length - label) / (n - 1), which bounds the label at (2 length - space (n - 1)) / (n + 1)
  const most = Math.max(0, (2 * length - SPACE * (n - 1)) / (n + 1));
  const side = { w: area.w / 2 - MARKER / 2 - SPACE, h: area.h / 2 - MARKER / 2 - SPACE };
  const label = right
    ? { w: Math.min(need.w, most), h: Math.max(0, Math.min(need.h, side.h)) }
    : { w: Math.max(0, Math.min(need.w, side.w)), h: Math.min(need.h, most) };
  const first = (right ? label.w : label.h) / 2;
  const step = (length - 2 * first) / (n - 1);
  const shapes: TemplateShapeDraft[] = [];
  items.forEach((item, i) => {
    const along = first + i * step;
    const at = right ? { x: area.x + along, y: across.y } : { x: across.x, y: area.y + along };
    const boxes = placed(at, label, i % 2 === 0, o.direction);
    const style = shapeStyle('milestone', i, o.colors);
    shapes.push(
      { key: `marker-${i}`, slot: 'marker', index: i, shape: 'basic:ellipse', box: boxes.marker, label: '', style: shapeStyle('marker', i, o.colors) },
      { key: `milestone-${i}`, slot: 'milestone', index: i, shape: 'basic:rounded-rect', box: boxes.label, label: item.label, ...detailOf(item), style },
    );
  });
  const connectors: TemplateConnectorDraft[] = items
    .slice(1)
    .map((_, i) => ({ key: `line-${i}`, slot: 'line', from: `marker-${i}`, to: `marker-${i + 1}`, style: connectorStyle('line') }));
  return { shapes, connectors };
}

/**
 * `timeline.milestones`: milestones along a line, labels alternating sides.
 *
 * @public
 */
export const timelineMilestonesTemplate: TemplateDef<MilestonesOptions> = {
  id: 'timeline.milestones',
  describe: 'A timeline: milestones in order along a line, labels alternating sides, left to right or top to bottom.',
  version: '1',
  items: itemsSchema(2, MAX_MILESTONES),
  schema,
  slots: {
    marker: { shape: 'basic:ellipse', role: 'marker' },
    milestone: { shape: 'basic:rounded-rect', role: 'milestone' },
    line: { shape: 'connector', role: 'line' },
  },
  build,
  adapt: (frame, o) => (frame.h > frame.w && o.direction === 'right' ? { ...o, direction: 'down' } : o),
};
