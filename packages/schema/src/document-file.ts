// The whole document (02-document-model §1, §7, FR-DOC-001): a versioned map of normalized records.
// Each record is checked by the schema of its `type` (and `kind` for elements); unknown types and
// element kinds keep only their envelope checked and are otherwise preserved (FR-DOC-005).
import { z } from 'zod';
import { checkedSchema } from './checked-schema.js';
import type { RecordId } from './ids.js';
import { type Extensible, recordIdSchema } from './primitives.js';
import {
  type BehaviourRecord,
  commentRecordSchema,
  interactionRecordSchema,
  stepRecordSchema,
  timelineRecordSchema,
  variableRecordSchema,
} from './records/behaviour.js';
import { type BindingRecord, bindingRecordSchema } from './records/binding.js';
import { type DocumentRecord, documentRecordSchema } from './records/document.js';
import { type ElementRecord, isCoreElementKind, type UnknownElement } from './records/element.js';
import { qualifiedNameSchema } from './records/element-base.js';
import { elementKindSchemas } from './records/element-schemas.js';
import { assetRecordSchema, pluginRefRecordSchema, type ResourceRecord, themeRecordSchema } from './records/resources.js';
import { type ScreenRecord, screenRecordSchema } from './records/screen.js';
import { type SectionRecord, sectionRecordSchema } from './records/section.js';

/**
 * A record of a type this version does not know (from a newer minor version); kept verbatim
 * (FR-DOC-005).
 *
 * @public
 */
export type UnknownRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** The unknown type. */
  readonly type: string;
}>;

/**
 * Any record of a document.
 *
 * @public
 */
export type AnyRecord =
  | DocumentRecord
  | ScreenRecord
  | SectionRecord
  | ElementRecord
  | UnknownElement
  | BindingRecord
  | ResourceRecord
  | BehaviourRecord
  | UnknownRecord;

/**
 * The record types this version knows.
 *
 * @public
 */
export const RECORD_TYPES: readonly string[] = [
  'document',
  'screen',
  'section',
  'element',
  'binding',
  'asset',
  'theme',
  'timeline',
  'step',
  'interaction',
  'variable',
  'plugin-ref',
  'comment',
];

/**
 * The schema version this package reads and writes (`MAJOR.MINOR`).
 *
 * @public
 */
export const SCHEMA_VERSION: string = '1.1';

/**
 * A document file: schema version plus records keyed by ID.
 *
 * @public
 */
export type DocumentFile = Extensible<{
  /** `MAJOR.MINOR` schema version of the records. */
  readonly schemaVersion: string;
  /** All records, keyed by their `id`. */
  readonly records: { readonly [id: string]: AnyRecord };
}>;

const BY_TYPE: { readonly [type: string]: z.ZodType<AnyRecord> } = {
  document: documentRecordSchema,
  screen: screenRecordSchema,
  section: sectionRecordSchema,
  binding: bindingRecordSchema,
  asset: assetRecordSchema,
  theme: themeRecordSchema,
  'plugin-ref': pluginRefRecordSchema,
  timeline: timelineRecordSchema,
  step: stepRecordSchema,
  interaction: interactionRecordSchema,
  variable: variableRecordSchema,
  comment: commentRecordSchema,
};

const unknownRecordSchema = checkedSchema<UnknownRecord>()(z.looseObject({ id: recordIdSchema, type: z.string().min(1) }));

/**
 * How a record is checked: by the schema of its type (and element kind), and whether that type
 * and kind are known to this version.
 *
 * @public
 */
export type RecordSchemaChoice = {
  /** The schema to parse the record with. */
  readonly schema: z.ZodType<AnyRecord>;
  /** `false` for an unknown record type or an unknown non-plugin element kind. */
  readonly known: boolean;
};

const field = (record: unknown, key: string): unknown =>
  typeof record === 'object' && record !== null ? (record as { readonly [k: string]: unknown })[key] : undefined;

/**
 * Pick the schema for `record` by its `type` (and `kind` for elements). Plugin element kinds
 * (`<plugin>:<name>`) are known; other unknown kinds and types get an envelope-only schema.
 *
 * @public
 */
export function schemaForRecord(record: unknown): RecordSchemaChoice {
  const type = field(record, 'type');
  if (type === 'element') {
    const kind = field(record, 'kind');
    if (isCoreElementKind(kind)) return { schema: elementKindSchemas[kind], known: true };
    if (qualifiedNameSchema.safeParse(kind).success) return { schema: elementKindSchemas.plugin, known: true };
    return { schema: elementKindSchemas.unknown, known: false };
  }
  const schema = typeof type === 'string' ? BY_TYPE[type] : undefined;
  return schema ? { schema, known: true } : { schema: unknownRecordSchema, known: false };
}

/**
 * Any record, checked by the schema {@link schemaForRecord} picks. The inner issues keep their Zod
 * codes and inputs (M2.8 review F1); nothing is transformed, so the output is the input (ADR-0142).
 */
export const anyRecordSchema: z.ZodType<AnyRecord> = z
  .custom<AnyRecord>((value) => typeof value === 'object' && value !== null && !Array.isArray(value), { message: 'a record must be an object' })
  .superRefine((value, ctx) => {
    const r = schemaForRecord(value).schema.safeParse(value);
    if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ ...issue });
  });

/** Schema of a whole document file. */
export const documentFileSchema: z.ZodType<DocumentFile> = checkedSchema<DocumentFile>()(
  z.looseObject({
    schemaVersion: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'expected a MAJOR.MINOR schema version such as "1.0" (no leading zeros)'),
    records: z.record(z.string(), anyRecordSchema),
  }),
);
