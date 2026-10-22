// The comparison template (FR-LAY-014, ADR-0047): exactly two items, each a header over its children as points, side by side in two columns
// (a portrait frame stacks them as rows instead). Headers take the colour scheme; points are outlined on the surface in their header's
// colour, so the two sides read apart. Every header, and every point, is as tall as the tallest of its kind needs; the spacing between
// points gives way first, and a side with more points than the frame holds at that height runs past it.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { colorsSchema, commonSize, detailOf, halfBox, inset, itemsSchema, shapeStyle } from './slot-sizing.js';
import type { TemplateContext, TemplateDef, TemplateItem, TemplateResult, TemplateShapeDraft } from './types.js';

/**
 * Options of `comparison`.
 *
 * @public
 */
export type ComparisonOptions = {
  /** `columns` side by side (default) or `rows`, one above the other. */
  readonly direction: 'columns' | 'rows';
  /** Space between the two sides, px (default 32). */
  readonly gap: number;
  /** Space between a side's header and points, and between points, px (default 8). */
  readonly spacing: number;
  /** Space between the frame's edge and the comparison, px (default 40). */
  readonly padding: number;
  /** The colour scheme of the headers (default `colorful`). */
  readonly colors: 'colorful' | 'primary' | 'outline';
};

/** At most this many points a side. */
const MAX_POINTS = 8;

const schema = z
  .strictObject({
    direction: z.enum(['columns', 'rows']).default('columns'),
    gap: z.number().finite().min(0).default(32),
    spacing: z.number().finite().min(0).default(8),
    padding: z.number().finite().min(0).default(40),
    colors: colorsSchema.default('colorful'),
  })
  .default({ direction: 'columns', gap: 32, spacing: 8, padding: 40, colors: 'colorful' });

/** The items: exactly two sides, each with at most {@link MAX_POINTS} points. */
const items = itemsSchema(2, 2).refine(
  (sides) => sides.every((side) => (side.children ?? []).length <= MAX_POINTS),
  `each side takes at most ${MAX_POINTS} points`,
);

/** The header's and points' boxes of one side, its top left at `at`, `w` wide, header `head` and points `point` tall. */
function side(at: { x: number; y: number }, w: number, sizes: { head: number; point: number; spacing: number }, points: number): Box[] {
  const header = { x: at.x, y: at.y, w, h: sizes.head };
  const rest = Array.from({ length: points }, (_, j) => ({
    x: at.x,
    y: at.y + sizes.head + sizes.spacing + j * (sizes.point + sizes.spacing),
    w,
    h: sizes.point,
  }));
  return [header, ...rest].map(halfBox);
}

function build(sides: readonly TemplateItem[], o: ComparisonOptions, ctx: TemplateContext): TemplateResult {
  const area = inset(ctx.frame, o.padding);
  const points = sides.map((s) => s.children ?? []);
  const head = commonSize(sides, ctx).h;
  const point = commonSize(points.flat(), ctx).h;
  const most = Math.max(...points.map((p) => p.length));
  const tall = (spacing: number): number => head + most * (point + spacing);
  // in columns the sides share the width; in rows the height, the spacing giving way first
  const rows = o.direction === 'rows';
  const height = rows ? (area.h - o.gap) / 2 : area.h;
  const spacing = most === 0 ? o.spacing : Math.min(o.spacing, Math.max(0, (height - head - most * point) / most));
  const w = rows ? area.w : (area.w - o.gap) / 2;
  const block = tall(spacing);
  const origin = rows ? { x: area.x, y: area.y + (area.h - (block * 2 + o.gap)) / 2 } : { x: area.x, y: area.y + (area.h - block) / 2 };
  const shapes: TemplateShapeDraft[] = [];
  let index = 0;
  sides.forEach((s, c) => {
    const at = rows ? { x: origin.x, y: origin.y + c * (block + o.gap) } : { x: origin.x + c * (w + o.gap), y: origin.y };
    const [header, ...rest] = side(at, w, { head, point, spacing }, points[c]?.length ?? 0);
    shapes.push({
      key: `header-${c}`,
      slot: 'header',
      index: index++,
      shape: 'basic:rounded-rect',
      box: header as Box,
      label: s.label,
      ...detailOf(s),
      style: shapeStyle('header', c, o.colors),
    });
    (points[c] ?? []).forEach((p, j) => {
      shapes.push({
        key: `point-${c}-${j}`,
        slot: 'point',
        index: index++,
        shape: 'basic:rounded-rect',
        box: rest[j] as Box,
        label: p.label,
        ...detailOf(p),
        style: {
          ...shapeStyle('point', c, 'outline'),
          stroke: { color: shapeStyle('point', c, o.colors === 'outline' ? 'primary' : o.colors).fill as string, width: 2 },
        },
      });
    });
  });
  return { shapes, connectors: [] };
}

/**
 * `comparison`: two sides, each a header over its points.
 *
 * @public
 */
export const comparisonTemplate: TemplateDef<ComparisonOptions> = {
  id: 'comparison',
  describe: 'A comparison of two options: each a header over its points, side by side (stacked in a portrait frame).',
  version: '1',
  items,
  schema,
  slots: { header: { shape: 'basic:rounded-rect', role: 'header' }, point: { shape: 'basic:rounded-rect', role: 'point' } },
  build,
  adapt: (frame, o) => (frame.h > frame.w && o.direction === 'columns' ? { ...o, direction: 'rows' } : o),
};
