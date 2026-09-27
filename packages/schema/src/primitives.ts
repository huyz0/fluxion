// Shared field schemas of every record: IDs, fractional-index keys and the open-object rule.
import { z } from 'zod';
import { type IndexKey, isIndexKey } from './fractional-index.js';
import { isRecordId, type RecordId } from './ids.js';

/**
 * An object type that also keeps any unknown keys (FR-DOC-005): data written by a newer version
 * or a plugin survives a load/save round trip.
 *
 * @public
 */
export type Extensible<T> = T & { readonly [key: string]: unknown };

/**
 * Free-form metadata on any record; preserved as is.
 *
 * @public
 */
export type Meta = { readonly [key: string]: unknown };

/** A record ID field. */
export const recordIdSchema: z.ZodType<RecordId> = z.custom<RecordId>(isRecordId, {
  message: 'expected a record id: 1-64 characters of A-Z a-z 0-9 _ -',
});

/** A fractional-index key field (ADR-0012). */
export const indexKeySchema: z.ZodType<IndexKey> = z.custom<IndexKey>(isIndexKey, {
  message: 'expected a fractional-index key such as "a0"',
});

/** The `meta` field of every record. */
export const metaSchema: z.ZodType<Meta> = z.record(z.string(), z.unknown());

/** A finite number (Zod 4 already rejects NaN and ±Infinity). */
export const finite: z.ZodNumber = z.number();
