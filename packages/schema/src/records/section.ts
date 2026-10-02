// The `section` record (FR-SCR-004, ADR-0021): a named group of screens in the navigator, and later the site's navigation.
// Screens name their section with `screen.sectionId`; sections are ordered among themselves by `index`.
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import type { IndexKey } from '../fractional-index.js';
import type { RecordId } from '../ids.js';
import { type Extensible, indexKeySchema, type Meta, metaSchema, recordIdSchema } from '../primitives.js';

/**
 * A section: a named, ordered group of screens.
 *
 * @public
 */
export type SectionRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Record type. */
  readonly type: 'section';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** Its name. */
  readonly name: string;
  /** Fractional index among the sections. */
  readonly index: IndexKey;
  /** Whether the navigator shows it folded (editor presentation, kept on the record). */
  readonly collapsed?: boolean;
}>;

/** Schema of the `section` record. */
export const sectionRecordSchema: z.ZodType<SectionRecord> = checkedSchema<SectionRecord>()(
  z.looseObject({
    id: recordIdSchema,
    type: z.literal('section'),
    meta: metaSchema.optional(),
    name: z.string(),
    index: indexKeySchema,
    collapsed: z.boolean().optional(),
  }),
);
