// The record store (ADR-0002, 03-core-engine §1): a flat map of frozen records with one signal per
// record, so a change notifies only that record's readers (NFR-MNT-006). `transact` is the only
// write path (ADR-0014).
import { type AnyRecord, type Diagnostic, type DocumentFile, err, ok, type RecordId, type Result } from '@fluxion/schema';
import { batch, type ReadSignal, type WritableSignal, writable } from './signals.js';
import {
  checkDiff,
  cloneJson,
  type Diff,
  deepFreeze,
  netDiff,
  referentialErrors,
  type Tx,
  type TxFailure,
  type TxMeta,
  type TxOptions,
  WorkingCopy,
} from './transaction.js';

/**
 * A document's records: read them, watch them, and change them through transactions.
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
  /**
   * Run `fn` as one transaction (ADR-0014): its net diff is validated, then applied and announced
   * once. On an invalid result nothing changes and the failure carries the diagnostics; a throw
   * from `fn` rolls back and is rethrown. A call inside an open transaction joins it.
   */
  transact<R>(label: string, fn: (tx: Tx) => R, options?: TxOptions): Result<R, TxFailure>;
  /** Call `listener` after every committed transaction with a non-empty diff; returns an unsubscribe. */
  subscribe(listener: (diff: Diff, meta: TxMeta) => void): () => void;
}

/**
 * Options of {@link createStore}.
 *
 * @public
 */
export type StoreOptions = {
  /** Validate every transaction (default true); only production builds may switch it off (ADR-0014). */
  readonly validate?: boolean;
};

/** The store implementation; `apply` is core-internal (transactions and history call it). */
export class RecordStore implements Store {
  readonly #records = new Map<RecordId, AnyRecord>();
  readonly #signals = new Map<RecordId, WritableSignal<AnyRecord | undefined>>();
  readonly #listeners = new Set<(diff: Diff, meta: TxMeta) => void>();
  readonly #envelope: Omit<DocumentFile, 'records'>;
  readonly #validate: boolean;
  #open: WorkingCopy | undefined;
  // referential errors the document already has (computed on first use), so they do not block
  // unrelated transactions; replaced by the post-state's after each commit
  #knownErrors: Map<string, Diagnostic> | undefined;

  constructor(file: DocumentFile, options: StoreOptions = {}) {
    const { records, ...envelope } = cloneJson(file);
    this.#envelope = envelope;
    this.#validate = options.validate ?? true;
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

  transact<R>(label: string, fn: (tx: Tx) => R, options: TxOptions = {}): Result<R, TxFailure> {
    // nested: join the open transaction; its commit is the authoritative result (ADR-0014). A throw
    // from the inner fn undoes the inner writes only (a savepoint), then propagates.
    if (this.#open) return ok(this.#open.savepoint(fn));
    const tx = new WorkingCopy((id) => this.#records.get(id));
    this.#open = tx;
    let value: R;
    try {
      value = fn(tx);
    } finally {
      this.#open = undefined;
    }
    const diff = netDiff(tx.changes, (id) => this.#records.get(id));
    if (diff.puts.size === 0 && diff.deletes.size === 0) return ok(value);
    if (this.#validate) {
      const problems = this.#check(diff);
      if (problems.length) return err({ code: 'TX_INVALID', message: `${label}: ${problems.length} validation error(s)`, diagnostics: problems });
    }
    this.apply(
      [...diff.puts.values()].map((p) => p.after),
      [...diff.deletes.keys()],
    );
    const meta: TxMeta = { ...options, label, origin: options.origin ?? 'user' };
    for (const listener of [...this.#listeners]) listener(diff, meta);
    return ok(value);
  }

  subscribe(listener: (diff: Diff, meta: TxMeta) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Validation problems of `diff`; on none, the post-state's referential errors become the known ones. */
  #check(diff: Diff): readonly Diagnostic[] {
    this.#knownErrors ??= referentialErrors(this.#records);
    const post = new Map(this.#records);
    for (const [id, { after }] of diff.puts) post.set(id, after);
    for (const id of diff.deletes.keys()) post.delete(id);
    const { problems, after } = checkDiff(diff, post, this.#knownErrors);
    if (!problems.length) this.#knownErrors = after;
    return problems;
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
export function createStore(file: DocumentFile, options?: StoreOptions): Store {
  return new RecordStore(file, options);
}
