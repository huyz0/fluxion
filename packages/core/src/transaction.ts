// Transactions (ADR-0014 §Transactions): a working copy over the store, reduced to a net Diff of
// record puts and deletes (NFR-MNT-006), validated before it is applied.
import { type AnyRecord, type Diagnostic, type RecordId, validateRecord, validateReferences } from '@fluxion/schema';
import type { CoreError } from './errors.js';

/**
 * Who made a transaction (ADR-0014): history records `user` and `system` ones only.
 *
 * @public
 */
export type TxOrigin = 'user' | 'undo' | 'redo' | 'remote' | 'system';

/**
 * Options of {@link Store.transact}; only the outermost call's options count.
 *
 * @public
 */
export type TxOptions = {
  /** Who is writing (default `user`). */
  readonly origin?: TxOrigin;
  /** Merge key: consecutive transactions with the same key and origin form one undo step. */
  readonly mergeKey?: string;
  /** Opaque state before the change (the editor's selection and view); core never reads it. */
  readonly metaBefore?: unknown;
  /** Opaque state after the change; core never reads it. */
  readonly metaAfter?: unknown;
};

/**
 * What subscribers learn about a committed transaction besides its diff.
 *
 * @public
 */
export type TxMeta = TxOptions & {
  /** Human-readable label. */
  readonly label: string;
  /** Who wrote. */
  readonly origin: TxOrigin;
};

/**
 * A put in a {@link Diff}: `before` is absent for a created record.
 *
 * @public
 */
export type PutChange = {
  /** The record before the transaction, if it existed. */
  readonly before?: AnyRecord;
  /** The record after the transaction. */
  readonly after: AnyRecord;
};

/**
 * The net change of one transaction: record puts and deletes only (NFR-MNT-006).
 *
 * @public
 */
export type Diff = {
  /** Created or changed records. */
  readonly puts: ReadonlyMap<RecordId, PutChange>;
  /** Deleted records, with their last value. */
  readonly deletes: ReadonlyMap<RecordId, AnyRecord>;
};

/**
 * Why a transaction was not applied; the store is unchanged.
 *
 * @public
 */
export type TxFailure = CoreError & {
  /** The problems found (validation diagnostics; empty for policy or hook-depth failures). */
  readonly diagnostics: readonly Diagnostic[];
};

/**
 * Write access inside {@link Store.transact}. Reads see the transaction's own writes.
 *
 * @public
 */
export interface Tx {
  /** The record with `id` as this transaction sees it. */
  get(id: RecordId): AnyRecord | undefined;
  /** Create or replace a record. */
  put(record: AnyRecord): void;
  /** Shallow-merge top-level fields into an existing record; a field set to undefined is removed. */
  patch(id: RecordId, fields: Readonly<Record<string, unknown>>): void;
  /** Remove a record. */
  delete(id: RecordId): void;
}

/** A deep copy of a JSON value (records are JSON; pure packages have no structuredClone). */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Freeze a JSON value and everything in it, also below objects that are already frozen. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Structural equality of JSON values (object key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The transaction's working copy: pending changes over the store's records (null = deleted). */
export class WorkingCopy implements Tx {
  readonly changes: Map<RecordId, AnyRecord | null> = new Map();
  readonly #read: (id: RecordId) => AnyRecord | undefined;
  #closed = false;

  constructor(read: (id: RecordId) => AnyRecord | undefined) {
    this.#read = read;
  }

  /** End the transaction: any later use throws (M3.11 review F2). */
  close(): void {
    this.#closed = true;
  }

  #open(): void {
    if (this.#closed) throw new Error('transaction is closed: use the Tx only inside its transact callback');
  }

  get(id: RecordId): AnyRecord | undefined {
    this.#open();
    const pending = this.changes.get(id);
    return pending === undefined ? this.#read(id) : (pending ?? undefined);
  }

  put(record: AnyRecord): void {
    this.#open();
    this.changes.set(record.id as RecordId, deepFreeze(cloneJson(record)));
  }

  patch(id: RecordId, fields: Readonly<Record<string, unknown>>): void {
    this.#open();
    const base = this.get(id);
    // patching a missing record, or its identity, is a programmer error (ADR-0014: a throw rolls back)
    if (!base) throw new Error(`patch: no record ${id}`);
    if (('id' in fields && fields['id'] !== base.id) || ('type' in fields && fields['type'] !== base.type))
      throw new Error(`patch: ${id} cannot change id or type`);
    const next: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(cloneJson(fields))) next[key] = value;
    // the JSON copy drops undefined values; they mean: remove the field
    for (const [key, value] of Object.entries(fields)) if (value === undefined) delete next[key];
    this.changes.set(id, deepFreeze(next as AnyRecord));
  }

  delete(id: RecordId): void {
    this.#open();
    this.changes.set(id, null);
  }

  /** Run `fn` on this copy; if it throws, drop its changes (keeping earlier ones) and rethrow. */
  savepoint<R>(fn: (tx: Tx) => R): R {
    const saved = new Map(this.changes);
    try {
      return fn(this);
    } catch (e) {
      this.changes.clear();
      for (const [id, record] of saved) this.changes.set(id, record);
      throw e;
    }
  }
}

/** The net diff of `changes` against `read`: created-then-deleted and unchanged records drop out. */
export function netDiff(changes: ReadonlyMap<RecordId, AnyRecord | null>, read: (id: RecordId) => AnyRecord | undefined): Diff {
  const puts = new Map<RecordId, PutChange>();
  const deletes = new Map<RecordId, AnyRecord>();
  for (const [id, after] of changes) {
    const before = read(id);
    if (after === null) {
      if (before) deletes.set(id, before);
    } else if (!before) puts.set(id, { after });
    else if (!jsonEqual(before, after)) puts.set(id, { before, after });
  }
  return { puts, deletes };
}

/** Identity of a diagnostic, to tell new referential errors from ones the document already had. */
// the message names the target, so a reference moved to another missing id counts as new (M3.11 review F3)
export const diagnosticKey = (d: Diagnostic): string => `${d.code} ${d.path} ${d.message}`;

/** Referential error keys of a record map. */
export function referentialErrors(records: ReadonlyMap<RecordId, AnyRecord>): Map<string, Diagnostic> {
  const errors = validateReferences(records).filter((d) => d.severity === 'error');
  return new Map(errors.map((d) => [diagnosticKey(d), d]));
}

/**
 * Validation of a diff (ADR-0014): the changed records against their schemas, then the post-state's
 * references; only referential errors the pre-state did not have count. Returns the error
 * diagnostics and, when there are none, the post-state's referential error keys.
 */
export function checkDiff(
  diff: Diff,
  post: ReadonlyMap<RecordId, AnyRecord>,
  before: ReadonlyMap<string, Diagnostic>,
): { readonly problems: readonly Diagnostic[]; readonly after: Map<string, Diagnostic> } {
  const structural = [...diff.puts].flatMap(([id, { after }]) => validateRecord(id, after)).filter((d) => d.severity === 'error');
  if (structural.length) return { problems: structural, after: new Map(before) };
  const after = referentialErrors(post);
  return { problems: [...after].filter(([key]) => !before.has(key)).map(([, d]) => d), after };
}
