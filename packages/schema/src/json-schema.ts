// The JSON Schema of a document file (FR-AI-001), generated from the Zod record schemas: the single source of truth is the code, the committed
// copy in specs/schema/ is checked against it by json-schema.test.ts (a file snapshot, rewritten with `vitest -u`).
import { z } from 'zod';
import { schemaForRecord } from './document-file.js';
import { elementKindSchemas } from './records/element-schemas.js';

/** The record types other than `element`, in the order the document model lists them (02-document-model §1). */
const PLAIN_TYPES = ['document', 'screen', 'section', 'binding', 'asset', 'theme', 'timeline', 'step', 'interaction', 'variable', 'plugin-ref', 'comment'];

/**
 * The JSON Schema (draft 2020-12) of a document file: `schemaVersion` and `records`, each record checked by the schema of its type and, for
 * elements, of its kind. A record of a type or kind this version does not know matches the envelope alone (FR-DOC-005).
 *
 * @public
 */
export function documentJsonSchema(): { readonly [key: string]: unknown } {
  const records = [
    ...PLAIN_TYPES.map((type) => schemaForRecord({ type }).schema),
    ...Object.keys(elementKindSchemas).map((kind) => schemaForRecord({ type: 'element', kind }).schema),
    schemaForRecord({ type: '?' }).schema,
  ];
  const file = z.looseObject({
    schemaVersion: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
    records: z.record(z.string(), z.union(records as [z.ZodType, z.ZodType, ...z.ZodType[]])),
  });
  return { title: 'Fluxion document file', ...z.toJSONSchema(file, { unrepresentable: 'any', io: 'input', reused: 'ref' }) };
}
