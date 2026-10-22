// What the built-in templates share for their slots (FR-LAY-014, ADR-0047): the items schema, the colour schemes as theme tokens, label
// measuring and the half-pixel rounding every box goes through.
import type { FontSpec } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import type { TemplateContext, TemplateItem, TemplateStyle } from './types.js';

/** How deep items may nest; the same limit as a stored `template` layout spec's (`@fluxion/schema`'s `MAX_TEMPLATE_DEPTH`). */
export const MAX_DEPTH = 64;

/** How many items, children included, a template takes at most, so a hostile list cannot make building slow or deep. */
export const MAX_ITEMS = 256;

/** Why `items` nest too deep or are too many in all, or undefined: level by level, without recursion. */
function tooMany(items: unknown): string | undefined {
  let level: unknown[] = Array.isArray(items) ? items : [items];
  let total = 0;
  for (let depth = 0; level.length > 0; depth++) {
    if (depth === MAX_DEPTH) return `items nest deeper than ${MAX_DEPTH} levels`;
    total += level.length;
    if (total > MAX_ITEMS) return `more than ${MAX_ITEMS} items in all`;
    // each object once per level, so a cyclic value stops at the limits
    level = [...new Set(level.flatMap((item) => (item as { children?: unknown } | null)?.children ?? []))];
  }
  return undefined;
}

const itemSchema: z.ZodType<TemplateItem> = z.looseObject({
  label: z.string(),
  detail: z.string().optional(),
  get children() {
    return z.array(itemSchema).optional();
  },
}) as z.ZodType<TemplateItem>;

/** The items schema of a template that takes `min` to `max` items; `children` are kept but only a nesting template reads them. */
export function itemsSchema(min: number, max: number): z.ZodType<readonly TemplateItem[]> {
  return z.preprocess((value, ctx) => {
    const problem = tooMany(value);
    if (problem) ctx.issues.push({ code: 'custom', input: value, message: problem });
    return value;
  }, z.array(itemSchema).min(min).max(max));
}

/**
 * The colour schemes a template's shapes take, all theme tokens: `colorful` cycles the six accents, `primary` fills every shape with the
 * primary colour, `outline` draws them on the surface with a primary stroke.
 */
export const colorsSchema: z.ZodEnum<{ colorful: 'colorful'; primary: 'primary'; outline: 'outline' }> = z.enum(['colorful', 'primary', 'outline']);

/** One of {@link colorsSchema}'s schemes. */
export type Colors = 'colorful' | 'primary' | 'outline';

/** The number of accent colours a theme defines (`color.accent-1` to `color.accent-6`). */
const ACCENTS = 6;

/** The style of the `index`th shape of slot `role` in scheme `colors`. */
export function shapeStyle(role: string, index: number, colors: Colors): TemplateStyle {
  if (colors === 'outline') return { variant: role, fill: '{color.surface}', stroke: { color: '{color.primary}', width: 2 }, font: { color: '{color.text}' } };
  const fill = colors === 'primary' ? '{color.primary}' : `{color.accent-${(index % ACCENTS) + 1}}`;
  return { variant: role, fill, stroke: { color: fill, width: 0 }, font: { color: '{color.background}' } };
}

/** The style of a connector of slot `role`. */
export const connectorStyle = (role: string): TemplateStyle => ({ variant: role, stroke: { color: '{color.connector}', width: 2 } });

/** The labels' font when the context names none: the built-in themes' body font at 20 px. */
const DEFAULT_FONT: FontSpec = { family: 'Inter', size: 20 };

/** The detail line's size, a share of the label's. */
const DETAIL_SCALE = 0.75;

/** Space between a label and its shape's edge, px. */
const PAD = { x: 24, y: 16 };

/** The smallest shape a template draws, px. */
export const MIN_SIZE = { w: 120, h: 64 };

/** The size the shape of `item` needs for its label and detail, padded, at least {@link MIN_SIZE}. */
export function sizeOf(item: TemplateItem, ctx: TemplateContext): { readonly w: number; readonly h: number } {
  const font = ctx.font ?? DEFAULT_FONT;
  const label = ctx.measure.measure(item.label, font);
  const detail = item.detail === undefined ? undefined : ctx.measure.measure(item.detail, { ...font, size: font.size * DETAIL_SCALE });
  const w = Math.max(label.width, detail?.width ?? 0) + PAD.x * 2;
  const h = label.height + (detail?.height ?? 0) + PAD.y * 2;
  return { w: Math.max(MIN_SIZE.w, Math.ceil(w)), h: Math.max(MIN_SIZE.h, Math.ceil(h)) };
}

/** The largest size any of `items` needs: templates draw every slot of a kind at one size. */
export function commonSize(items: readonly TemplateItem[], ctx: TemplateContext): { w: number; h: number } {
  return items.map((item) => sizeOf(item, ctx)).reduce((a, b) => ({ w: Math.max(a.w, b.w), h: Math.max(a.h, b.h) }), { ...MIN_SIZE });
}

/** Round to the half pixel, never -0: the grid every built box lies on. */
export const half = (n: number): number => Math.round(n * 2) / 2 || 0;

/** `box` with its edges on the half pixel: edges, not origin and size, so boxes that do not overlap still do not after rounding. */
export const halfBox = (box: Box): Box => {
  const [x, y] = [half(box.x), half(box.y)];
  return { x, y, w: half(box.x + box.w) - x, h: half(box.y + box.h) - y };
};

/** `frame` without `padding` on each side, never smaller than nothing. */
export const inset = (frame: Box, padding: number): Box => ({
  x: frame.x + padding,
  y: frame.y + padding,
  w: Math.max(0, frame.w - padding * 2),
  h: Math.max(0, frame.h - padding * 2),
});

/** The drafts' optional fields, only when set (`exactOptionalPropertyTypes`). */
export const detailOf = (item: TemplateItem): { readonly detail?: string } => (item.detail === undefined ? {} : { detail: item.detail });
