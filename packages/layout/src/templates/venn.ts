// The Venn template (FR-LAY-014, ADR-0047): two or three items as circles that overlap, see-through so the overlaps show. Two sit side by
// side; three make a triangle, the first at the top. Neighbouring centres are 0.6 diameters apart, so each label is centred where no other
// circle reaches (a long label may still run into a lens; labels are not measured). The circles are as large as the frame allows. The only template whose shapes overlap: that is the point.
import { z } from 'zod';
import { colorsSchema, detailOf, halfBox, inset, itemsSchema, shapeStyle } from './slot-sizing.js';
import type { TemplateContext, TemplateDef, TemplateItem, TemplateResult } from './types.js';

/**
 * Options of `venn`.
 *
 * @public
 */
export type VennOptions = {
  /** Space between the frame's edge and the circles, px (default 40). */
  readonly padding: number;
  /** How opaque each circle is, 0 to 1 (default 0.7). */
  readonly opacity: number;
  /** The colour scheme (default `colorful`). */
  readonly colors: 'colorful' | 'primary' | 'outline';
};

/** The distance between neighbouring centres, in diameters. */
const SPREAD = 0.6;

/** The circles' centres for `n` items, in diameters from the top left of their bounding box, and that box's size. */
function layoutOf(n: number): { readonly centres: readonly (readonly [number, number])[]; readonly size: readonly [number, number] } {
  const r = 0.5;
  if (n === 2)
    return {
      centres: [
        [r, r],
        [r + SPREAD, r],
      ],
      size: [1 + SPREAD, 1],
    };
  const rise = SPREAD * Math.sin(Math.PI / 3);
  return {
    centres: [
      [r + SPREAD / 2, r],
      [r, r + rise],
      [r + SPREAD, r + rise],
    ],
    size: [1 + SPREAD, 1 + rise],
  };
}

const schema = z
  .strictObject({
    padding: z.number().finite().min(0).default(40),
    opacity: z.number().finite().min(0).max(1).default(0.7),
    colors: colorsSchema.default('colorful'),
  })
  .default({ padding: 40, opacity: 0.7, colors: 'colorful' });

function build(items: readonly TemplateItem[], o: VennOptions, ctx: TemplateContext): TemplateResult {
  const area = inset(ctx.frame, o.padding);
  const { centres, size } = layoutOf(items.length);
  const d = Math.min(area.w / size[0], area.h / size[1]);
  const origin = { x: area.x + (area.w - d * size[0]) / 2, y: area.y + (area.h - d * size[1]) / 2 };
  const shapes = items.map((item, i) => {
    const [cx, cy] = centres[i] as readonly [number, number];
    return {
      key: `set-${i}`,
      slot: 'set',
      index: i,
      shape: 'basic:ellipse',
      box: halfBox({ x: origin.x + (cx - 0.5) * d, y: origin.y + (cy - 0.5) * d, w: d, h: d }),
      label: item.label,
      ...detailOf(item),
      style: { ...shapeStyle('set', i, o.colors), opacity: o.opacity },
    };
  });
  return { shapes, connectors: [] };
}

/**
 * `venn`: two or three overlapping sets.
 *
 * @public
 */
export const vennTemplate: TemplateDef<VennOptions> = {
  id: 'venn',
  describe: 'A Venn diagram: two or three overlapping, see-through circles, for what sets share.',
  version: '1',
  items: itemsSchema(2, 3),
  schema,
  slots: { set: { shape: 'basic:ellipse', role: 'set' } },
  build,
};
