// The `screen` record (02-document-model §2, FR-SCR-001): an ordered page of the document.
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import type { IndexKey } from '../fractional-index.js';
import type { RecordId } from '../ids.js';
import { type Paint, paintSchema } from '../paint.js';
import { type Extensible, finite, indexKeySchema, type Meta, metaSchema, recordIdSchema } from '../primitives.js';
import { type RichTextDoc, richTextSchema } from '../rich-text.js';

/**
 * A width and height in logical pixels.
 *
 * @public
 */
export type Size = Extensible<{
  /** Width, positive. */
  readonly w: number;
  /** Height, positive. */
  readonly h: number;
}>;

/**
 * An axis-aligned rectangle in logical pixels.
 *
 * @public
 */
export type Rect = Extensible<{
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width, positive. */
  readonly w: number;
  /** Height, positive. */
  readonly h: number;
}>;

/**
 * The logical size of a fixed screen when none is given (FR-SCR-001).
 *
 * @public
 */
export const DEFAULT_SCREEN_SIZE: Size = { w: 1920, h: 1080 };

/**
 * A screen: one page of the document, ordered by `index`.
 *
 * @public
 */
export type ScreenRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'screen';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** Position among screens (fractional index, FR-DOC-010). */
  readonly index: IndexKey;
  /** Display name. */
  readonly name: string;
  /** `fixed`: a canvas of `size`; `infinite`: an unbounded canvas shown through `viewport`. */
  readonly kind: 'fixed' | 'infinite';
  /** Logical size of a fixed screen (default 1920 × 1080). */
  readonly size: Size;
  /** Initial view of an infinite screen (required when `kind` is `infinite`). */
  readonly viewport?: Rect;
  /** Background paint: colour, gradient, image or token. */
  readonly background?: Paint;
  /** Master screen whose elements show behind this one. */
  readonly masterId?: RecordId;
  /** Element this screen is a sub-screen of (drill-down). */
  readonly parentElementId?: RecordId;
  /** Section (group of screens) this screen belongs to. */
  readonly sectionId?: RecordId;
  /** Hidden screens are skipped in presentation. */
  readonly hidden?: boolean;
  /** Speaker notes. */
  readonly notes?: RichTextDoc;
}>;

const positive = z.number().positive();
const sizeSchema = checkedSchema<Size>()(z.looseObject({ w: positive, h: positive }));
const rectSchema = checkedSchema<Rect>()(z.looseObject({ x: finite, y: finite, w: positive, h: positive }));

/** Schema of the `screen` record. */
export const screenRecordSchema: z.ZodType<ScreenRecord> = checkedSchema<ScreenRecord>()(
  z
    .looseObject({
      id: recordIdSchema,
      type: z.literal('screen'),
      meta: metaSchema.optional(),
      index: indexKeySchema,
      name: z.string().default(''),
      kind: z.enum(['fixed', 'infinite']).default('fixed'),
      size: sizeSchema.default(() => ({ ...DEFAULT_SCREEN_SIZE })),
      viewport: rectSchema.optional(),
      background: paintSchema.optional(),
      masterId: recordIdSchema.optional(),
      parentElementId: recordIdSchema.optional(),
      sectionId: recordIdSchema.optional(),
      hidden: z.boolean().optional(),
      notes: richTextSchema.optional(),
    })
    // an infinite canvas has no size of its own; its first view must be stated (M2.6 r2 F3)
    .refine((s) => s.kind !== 'infinite' || s.viewport !== undefined, { message: 'an infinite screen needs a viewport', path: ['viewport'] }),
);
