/**
 * `@fluxion/schema` — Zod 4 schemas and TS types for every record; IDs; validation errors; JSON Schema generation; migrations.
 *
 * @packageDocumentation
 */

export { createId, ID_ALPHABET, ID_LENGTH, isGeneratedId, isRecordId, type Random, type RecordId, seededRandom } from './ids.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
