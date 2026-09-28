// The record store (ADR-0002, 03-core-engine §1): a flat map of frozen records with one signal per
// record, so a change notifies only that record's readers (NFR-MNT-006). Writes arrive through
// `apply`, which transactions (M3.11) are the only callers of.
import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { batch, type ReadSignal, type WritableSignal, writable } from './signals.js';

/**
 * Read access to a document's records.
 *
 * @public
 */
export interface Store {
  /** The record with `id`, frozen, or undefined. */
  get(id: RecordId): AnyRecord | undefined;
  /** Whether a record with `id` exists. */
  has(id: RecordId): boolean;
  /** Number of records. */
  readonly size: number;
  /** Every record id, in insertion order. */
  ids(): RecordId[];
  /** A signal of the record with `id` (undefined while absent); it changes only when that record does. */
  record$(id: RecordId): ReadSignal<AnyRecord | undefined>;
  /** The document file: the envelope it was created from, with the current records. */
  toDocument(): DocumentFile;
}

/** A deep copy of a JSON value (records are JSON; pure packages have no structuredClone). */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Freeze a JSON value and everything in it (records are immutable values, coding-typescript rule 14). */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The store implementation; `apply` is core-internal. */
export class RecordStore implements Store {
  readonly #records = new Map<RecordId, AnyRecord>();
  readonly #signals = new Map<RecordId, WritableSignal<AnyRecord | undefined>>();
  readonly #envelope: Omit<DocumentFile, 'records'>;

  constructor(file: DocumentFile) {
    const { records, ...envelope } = cloneJson(file);
    this.#envelope = envelope;
    // map keys are the record ids (validate() reports a key/id mismatch as FLX_ID_MISMATCH)
    for (const [id, record] of Object.entries<AnyRecord>(records)) this.#records.set(id as RecordId, deepFreeze(record));
  }

  get(id: RecordId): AnyRecord | undefined {
    return this.#records.get(id);
  }

  has(id: RecordId): boolean {
    return this.#records.has(id);
  }

  get size(): number {
    return this.#records.size;
  }

  ids(): RecordId[] {
    return [...this.#records.keys()];
  }

  record$(id: RecordId): ReadSignal<AnyRecord | undefined> {
    let s = this.#signals.get(id);
    if (!s) {
      s = writable(this.#records.get(id));
      this.#signals.set(id, s);
    }
    return s.get;
  }

  toDocument(): DocumentFile {
    return { ...cloneJson(this.#envelope), records: cloneJson(Object.fromEntries(this.#records)) } as DocumentFile;
  }

  /** Replace or add `puts` and remove `deletes`, then notify each changed record's signal once. */
  apply(puts: readonly AnyRecord[], deletes: readonly RecordId[]): void {
    for (const record of puts) this.#records.set(record.id as RecordId, deepFreeze(record));
    for (const id of deletes) this.#records.delete(id);
    batch(() => {
      for (const record of puts) this.#signals.get(record.id as RecordId)?.set(this.#records.get(record.id as RecordId));
      for (const id of deletes) this.#signals.get(id)?.set(undefined);
    });
  }
}

/**
 * A store over `file`'s records (copied and frozen; the file itself is not changed).
 *
 * @public
 */
export function createStore(file: DocumentFile): Store {
  return new RecordStore(file);
}
