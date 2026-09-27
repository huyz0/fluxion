// Colours and paints (02-document-model §Style, FR-SCR-001 backgrounds). Styles store token
// references, not resolved colours; resolution is the theme package's job (M9).
import { z } from 'zod';
import { checkedSchema } from './checked-schema.js';
import { CSS_NAMED_COLORS } from './css-named-colors.js';
import type { RecordId } from './ids.js';
import { type Extensible, recordIdSchema } from './primitives.js';

/**
 * A reference to a design token, e.g. `{color.primary}` (dot-separated segments of
 * `A-Za-z0-9_-`).
 *
 * @public
 */
export type TokenRef = `{${string}}`;

const TOKEN = /^\{[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\}$/;

/** A token reference field. */
export const tokenRefSchema: z.ZodType<TokenRef> = z.custom<TokenRef>((v) => typeof v === 'string' && TOKEN.test(v), {
  message: 'expected a token reference such as "{color.primary}"',
});

/**
 * A literal CSS colour: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, a colour function
 * (`rgb()`, `hsl()`, `oklch()`, …) or a CSS named colour (`rebeccapurple`, `transparent`).
 *
 * @public
 */
export type Color = string;

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)$/i;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:%|deg|rad|grad|turn)?$/i;
const COLOR_SPACE = /^[a-z][a-z0-9-]*$/i;

/** `rgb(1 2 3)`, `hsl(10, 20%, 30%)`, `oklch(0.5 0.1 20 / 50%)`, `color(display-p3 1 0 0)`: 3–4 numeric channels (M2.6 r2 F2). */
function isColorFunction(value: string): boolean {
  const m = FUNCTION.exec(value.trim());
  if (!m) return false;
  const args = (m[2] ?? '').split(/[\s,/]+/).filter(Boolean);
  const channels = m[1]?.toLowerCase() === 'color' && COLOR_SPACE.test(args[0] ?? '') ? args.slice(1) : args;
  return channels.length >= 3 && channels.length <= 4 && channels.every((a) => a.toLowerCase() === 'none' || NUMBER.test(a));
}

/** A literal colour field. */
export const colorSchema: z.ZodType<Color> = z.string().refine((v) => HEX.test(v) || isColorFunction(v) || CSS_NAMED_COLORS.has(v.toLowerCase()), {
  message: 'expected a CSS colour (#hex, a colour function or a named colour)',
});

/**
 * An adjustment applied to a token colour.
 *
 * @public
 */
export type ColorTransform = Extensible<{
  /** Opacity multiplier, 0–1. */
  readonly alpha?: number;
  /** Lightness shift, -1 (black) to 1 (white). */
  readonly lighten?: number;
}>;

/**
 * A token colour with an adjustment.
 *
 * @public
 */
export type TransformedToken = Extensible<{
  /** The token to resolve. */
  readonly token: TokenRef;
  /** The adjustment applied after resolving it. */
  readonly transform: ColorTransform;
}>;

/**
 * A colour as stored: literal, token reference, or transformed token.
 *
 * @public
 */
export type ColorValue = Color | TokenRef | TransformedToken;

const colorTransformSchema = checkedSchema<ColorTransform>()(
  z.looseObject({ alpha: z.number().min(0).max(1).optional(), lighten: z.number().min(-1).max(1).optional() }),
);
const transformedTokenSchema = checkedSchema<TransformedToken>()(z.looseObject({ token: tokenRefSchema, transform: colorTransformSchema }));

/** A colour field: token references first, so `{…}` is never read as a named colour. */
export const colorValueSchema: z.ZodType<ColorValue> = checkedSchema<ColorValue>()(z.union([tokenRefSchema, colorSchema, transformedTokenSchema]));

/**
 * One colour stop of a gradient.
 *
 * @public
 */
export type GradientStop = Extensible<{
  /** Position along the gradient, 0–1. */
  readonly offset: number;
  /** Colour at this position. */
  readonly color: ColorValue;
}>;

/**
 * A linear or radial gradient.
 *
 * @public
 */
export type GradientPaint = Extensible<{
  /** Gradient kind. */
  readonly type: 'linear-gradient' | 'radial-gradient';
  /** Direction in degrees (linear only; 0 = left to right). */
  readonly angle?: number;
  /** At least two stops, in any order (renderers sort by offset). */
  readonly stops: readonly GradientStop[];
}>;

/**
 * An image fill from a document asset.
 *
 * @public
 */
export type ImagePaint = Extensible<{
  /** Paint kind. */
  readonly type: 'image';
  /** The `asset` record holding the image. */
  readonly assetId: RecordId;
  /** How the image fills the area (default `cover`). */
  readonly fit?: 'cover' | 'contain' | 'fill' | 'tile';
}>;

/**
 * A fill: a colour, a gradient or an image.
 *
 * @public
 */
export type Paint = ColorValue | GradientPaint | ImagePaint;

const gradientStopSchema = checkedSchema<GradientStop>()(z.looseObject({ offset: z.number().min(0).max(1), color: colorValueSchema }));
const gradientSchema = checkedSchema<GradientPaint>()(
  z.looseObject({
    type: z.enum(['linear-gradient', 'radial-gradient']),
    angle: z.number().optional(),
    stops: z.array(gradientStopSchema).min(2),
  }),
);
const imagePaintSchema = checkedSchema<ImagePaint>()(
  z.looseObject({ type: z.literal('image'), assetId: recordIdSchema, fit: z.enum(['cover', 'contain', 'fill', 'tile']).optional() }),
);

/** A paint field. */
export const paintSchema: z.ZodType<Paint> = checkedSchema<Paint>()(z.union([colorValueSchema, gradientSchema, imagePaintSchema]));
