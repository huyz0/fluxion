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
  /** Document title (default empty). */
  readonly title?: string;
  /** BCP 47 language tag of the content, e.g. `en` or `pt-BR`. */
  readonly lang?: string;
  /** The `theme` record in use. */
  readonly themeId?: RecordId;
  /** Document-wide settings. */
  readonly settings?: DocumentSettings;
  /** Author names. */
  readonly authors?: readonly string[];
  /** A short description of the document (schema 1.2, FR-DOC-006). */
  readonly description?: string;
  /** Free tags (schema 1.2). */
  readonly tags?: readonly string[];
  /** Custom key-value metadata, string values (schema 1.2). */
  readonly custom?: { readonly [key: string]: string };
  /** Creation time, ISO 8601. */
  readonly created?: string;
  /** Last modification time, ISO 8601. */
  readonly modified?: string;
  /** The FluxScript this document was compiled from: its id salt and the sections the compiler kept but did not compile (schema 1.3, ADR-0031). */
  readonly source?: DocumentSource;
}>;

/**
 * What a FluxScript compile keeps in the document (ADR-0030, ADR-0031).
 *
 * @public
 */
export type DocumentSource = Extensible<{
  /** The FluxScript grammar version. */
  readonly flux: 1;
  /** The id salt every compile into this document uses. */
  readonly salt: string;
  /** The YAML text of each deferred section, keyed by a pointer into the FluxScript (`/vars`, `/screens/<id>/steps`). */
  readonly deferred: { readonly [pointer: string]: string };
}>;

const sourceSchema = checkedSchema<DocumentSource>()(
  z.looseObject({
    flux: z.literal(1),
    salt: z.string(),
    deferred: z.record(z.string().startsWith('/'), z.string()),
  }),
);

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
    title: z.string().optional(),
    lang: z
      .string()
      .regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/)
      .optional(),
    themeId: recordIdSchema.optional(),
    settings: settingsSchema.optional(),
    authors: z.array(z.string()).optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    custom: z.record(z.string(), z.string()).optional(),
    created: z.iso.datetime({ offset: true }).optional(),
    modified: z.iso.datetime({ offset: true }).optional(),
    source: sourceSchema.optional(),
  }),
);
