// Element style and transform (02-document-model §Style, FR-SHP-001). Styles hold literals or token
// references; the theme resolves them (M9): element literal → token → theme defaults.
import { z } from 'zod';
import { checkedSchema } from './checked-schema.js';
import { type ColorValue, colorValueSchema, type Paint, paintSchema, type TokenRef, tokenRefSchema } from './paint.js';
import { type Extensible, finite } from './primitives.js';

/**
 * A style field value: a literal or a token reference (02-document-model §Style).
 *
 * @public
 */
export type StyleValue<T> = T | TokenRef;

/**
 * A numeric style value: a number or a token reference.
 *
 * @public
 */
export type StyleNumber = StyleValue<number>;

/**
 * A stroke (outline or connector line).
 *
 * @public
 */
export type Stroke = Extensible<{
  /** Line colour. */
  readonly color?: ColorValue;
  /** Line width in px (≥ 0). */
  readonly width?: StyleNumber;
  /** Dash pattern in px (alternating dash and gap lengths). */
  readonly dash?: readonly number[];
  /** Line cap. */
  readonly cap?: 'butt' | 'round' | 'square';
  /** Line join. */
  readonly join?: 'miter' | 'round' | 'bevel';
  /** Where the stroke sits: centred on the outline (default), inside it or outside it (ADR-0019). */
  readonly align?: 'center' | 'inside' | 'outside';
}>;

/**
 * A drop or inner shadow.
 *
 * @public
 */
export type Shadow = Extensible<{
  /** Horizontal offset in px. */
  readonly x: number;
  /** Vertical offset in px. */
  readonly y: number;
  /** Blur radius in px (≥ 0). */
  readonly blur: number;
  /** Spread in px. */
  readonly spread?: number;
  /** Shadow colour. */
  readonly color: ColorValue;
  /** Inner shadow instead of a drop shadow. */
  readonly inset?: boolean;
}>;

/**
 * A visual effect: glow or blur.
 *
 * @public
 */
export type Effect = Extensible<{
  /** Effect kind. */
  readonly type: 'glow' | 'blur';
  /** Radius in px (≥ 0). */
  readonly radius: number;
  /** Glow colour. */
  readonly color?: ColorValue;
}>;

/**
 * Text styling of an element.
 *
 * @public
 */
export type FontStyle = Extensible<{
  /** Font family name or token. */
  readonly family?: StyleValue<string>;
  /** Font size in px or token. */
  readonly size?: StyleNumber;
  /** Weight 1–1000 or token. */
  readonly weight?: StyleNumber;
  /** Italic or normal. */
  readonly style?: 'normal' | 'italic';
  /** Line height as a multiple of the size, or token. */
  readonly lineHeight?: StyleNumber;
  /** Extra letter spacing in px, or token. */
  readonly letterSpacing?: StyleNumber;
  /** Text colour. */
  readonly color?: ColorValue;
  /** Horizontal alignment. */
  readonly align?: 'left' | 'center' | 'right' | 'justify';
  /** Vertical alignment inside the element. */
  readonly verticalAlign?: 'top' | 'middle' | 'bottom';
}>;

/**
 * Visual style of an element; unset fields fall back to the theme.
 *
 * @public
 */
export type Style = Extensible<{
  /** Fill paint. */
  readonly fill?: Paint;
  /** Outline. */
  readonly stroke?: Stroke;
  /** Opacity 0–1, or token. */
  readonly opacity?: StyleNumber;
  /** Corner radius in px, or token. */
  readonly radius?: StyleNumber;
  /** Shadows, painted in order. */
  readonly shadow?: readonly Shadow[];
  /** Effects, applied in order. */
  readonly effects?: readonly Effect[];
  /** Text styling. */
  readonly font?: FontStyle;
  /** Theme variant name, e.g. `emphasis`. */
  readonly variant?: string;
}>;

/**
 * Position and size of an element in its screen (px), rotated about its centre.
 *
 * @public
 */
export type Transform = Extensible<{
  /** Left edge before rotation. */
  readonly x: number;
  /** Top edge before rotation. */
  readonly y: number;
  /** Width (≥ 0). */
  readonly w: number;
  /** Height (≥ 0). */
  readonly h: number;
  /** Rotation in degrees, clockwise, about the centre (default 0; read it with {@link transformRotation}). */
  readonly rot?: number;
  /** Mirror horizontally. */
  readonly flipX?: boolean;
  /** Mirror vertically. */
  readonly flipY?: boolean;
}>;

const nonNegative = z.number().min(0);
// a literal name starting with "{" is a mistyped token reference (M2.7 review F1)
const literalName = z
  .string()
  .min(1)
  .refine((v) => !v.startsWith('{'), { message: 'looks like a token reference but is not a valid one, e.g. "{font.body}"' });
const styleNumber = (literal: z.ZodNumber): z.ZodType<StyleNumber> => z.union([literal, tokenRefSchema]);

const strokeSchema = checkedSchema<Stroke>()(
  z.looseObject({
    color: colorValueSchema.meta({ ui: 'paint', group: 'Stroke', order: 1, label: 'Colour' }).optional(),
    width: styleNumber(nonNegative).meta({ ui: 'number', group: 'Stroke', order: 2, label: 'Width' }).optional(),
    dash: z.array(nonNegative).optional(),
    cap: z.enum(['butt', 'round', 'square']).optional(),
    join: z.enum(['miter', 'round', 'bevel']).optional(),
    align: z.enum(['center', 'inside', 'outside']).optional(),
  }),
);
const shadowSchema = checkedSchema<Shadow>()(
  z.looseObject({ x: finite, y: finite, blur: nonNegative, spread: finite.optional(), color: colorValueSchema, inset: z.boolean().optional() }),
);
const effectSchema = checkedSchema<Effect>()(z.looseObject({ type: z.enum(['glow', 'blur']), radius: nonNegative, color: colorValueSchema.optional() }));
const fontSchema = checkedSchema<FontStyle>()(
  z.looseObject({
    family: z.union([tokenRefSchema, literalName]).optional(),
    size: styleNumber(z.number().positive()).meta({ ui: 'number', group: 'Text', order: 1, label: 'Size' }).optional(),
    weight: styleNumber(z.number().min(1).max(1000)).optional(),
    style: z.enum(['normal', 'italic']).optional(),
    lineHeight: styleNumber(z.number().positive()).optional(),
    letterSpacing: styleNumber(finite).optional(),
    color: colorValueSchema.meta({ ui: 'paint', group: 'Text', order: 2, label: 'Colour' }).optional(),
    align: z.enum(['left', 'center', 'right', 'justify']).meta({ ui: 'select', group: 'Text', order: 3, label: 'Align' }).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  }),
);

/**
 * Schema of an element style.
 *
 * @public
 */
export const styleSchema: z.ZodType<Style> = checkedSchema<Style>()(
  z.looseObject({
    fill: paintSchema.meta({ ui: 'paint', group: 'Fill', order: 1, label: 'Fill' }).optional(),
    stroke: strokeSchema.optional(),
    opacity: styleNumber(z.number().min(0).max(1)).meta({ ui: 'slider', group: 'Appearance', order: 1, label: 'Opacity' }).optional(),
    radius: styleNumber(nonNegative).meta({ ui: 'number', group: 'Appearance', order: 2, label: 'Corner radius' }).optional(),
    shadow: z.array(shadowSchema).optional(),
    effects: z.array(effectSchema).optional(),
    font: fontSchema.optional(),
    variant: literalName.optional(),
  }),
);

/** Schema of an element transform. */
export const transformSchema: z.ZodType<Transform> = checkedSchema<Transform>()(
  z.looseObject({
    x: finite.meta({ ui: 'number', group: 'Layout', order: 1, label: 'X' }),
    y: finite.meta({ ui: 'number', group: 'Layout', order: 2, label: 'Y' }),
    w: nonNegative.meta({ ui: 'number', group: 'Layout', order: 3, label: 'Width' }),
    h: nonNegative.meta({ ui: 'number', group: 'Layout', order: 4, label: 'Height' }),
    rot: finite.meta({ ui: 'number', group: 'Layout', order: 5, label: 'Rotation' }).optional(),
    flipX: z.boolean().meta({ ui: 'toggle', group: 'Layout', order: 6, label: 'Flip horizontally' }).optional(),
    flipY: z.boolean().meta({ ui: 'toggle', group: 'Layout', order: 7, label: 'Flip vertically' }).optional(),
  }),
);

/**
 * The rotation of a transform in degrees: `rot`, or 0 when omitted (ADR-0142).
 *
 * @public
 */
export function transformRotation(transform: Pick<Transform, 'rot'>): number {
  return transform.rot ?? 0;
}
