// The `document` singleton record (02-document-model §2, FR-DOC-001).
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import type { RecordId } from '../ids.js';
import { type Extensible, type Meta, metaSchema, recordIdSchema } from '../primitives.js';

/**
 * Document-wide settings.
 *
 * @public
 */
export type DocumentSettings = Extensible<{
  /** How screens adapt to the viewport (FR-RSP): scale the fixed canvas, or reflow. */
  readonly responsive?: 'scale' | 'reflow';
  /** Whether the player honours the viewer's reduced-motion preference. */
  readonly reducedMotion?: 'respect' | 'ignore';
  /** Draw jumps where connectors cross. */
  readonly lineJumps?: boolean;
}>;

/**
 * The one `document` record of a file: title, language, theme and settings.
 *
 * @public
 */
export type DocumentRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'document';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** Document title. */
  readonly title: string;
  /** BCP 47 language tag of the content, e.g. `en` or `pt-BR`. */
  readonly lang?: string;
  /** The `theme` record in use. */
  readonly themeId?: RecordId;
  /** Document-wide settings. */
  readonly settings?: DocumentSettings;
  /** Author names. */
  readonly authors?: readonly string[];
  /** Creation time, ISO 8601. */
  readonly created?: string;
  /** Last modification time, ISO 8601. */
  readonly modified?: string;
}>;

const settingsSchema = checkedSchema<DocumentSettings>()(
  z.looseObject({
    responsive: z.enum(['scale', 'reflow']).optional(),
    reducedMotion: z.enum(['respect', 'ignore']).optional(),
    lineJumps: z.boolean().optional(),
  }),
);

/** Schema of the `document` record. */
export const documentRecordSchema: z.ZodType<DocumentRecord> = checkedSchema<DocumentRecord>()(
  z.looseObject({
    id: recordIdSchema,
    type: z.literal('document'),
    meta: metaSchema.optional(),
    title: z.string().default(''),
    lang: z
      .string()
      .regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/)
      .optional(),
    themeId: recordIdSchema.optional(),
    settings: settingsSchema.optional(),
    authors: z.array(z.string()).optional(),
    created: z.iso.datetime({ offset: true }).optional(),
    modified: z.iso.datetime({ offset: true }).optional(),
  }),
);
