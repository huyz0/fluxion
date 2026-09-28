// Undo/redo (ADR-0014 §History): entries are the committed diffs of user and system transactions
// plus the caller's opaque metaBefore/metaAfter; undo applies an entry's inverse and redo re-applies
// it, both through transact (origin undo/redo: validated, not re-recorded, hooks skipped). One of the
// two modules ADR-0014 lets call transact directly.
import { type AnyRecord, err, ok, type RecordId, type Result } from '@fluxion/schema';
import { type Diff, jsonEqual, type PutChange, type Tx, type TxFailure, type TxMeta, type TxOptions, type TxOrigin } from './transaction.js';

/**
 * Undo and redo of a store's user and system transactions.
 *
 * @public
 */
export interface History {
  /** Whether there is an entry to undo. */
  canUndo(): boolean;
  /** Whether there is an entry to redo. */
  canRedo(): boolean;
  /** Undo the latest entry; ok(its metaBefore), HISTORY_EMPTY, or the transaction's failure. */
  undo(): Result<unknown, TxFailure>;
  /** Redo the latest undone entry; ok(its metaAfter), HISTORY_EMPTY, or the transaction's failure. */
  redo(): Result<unknown, TxFailure>;
  /** Number of entries that can be undone. */
  readonly undoDepth: number;
  /** Number of entries that can be redone. */
  readonly redoDepth: number;
  /** End the current merge: the next transaction starts a new entry even with the same key (pointer-up). */
  seal(): void;
  /**
   * Run `fn` (commands, usually) as one transaction, so its writes are one undo step; the result is
   * that transaction's.
   */
  batch<R>(label: string, fn: () => R, options?: TxOptions): Result<R, TxFailure>;
}

/** One undo step. */
type Entry = {
  readonly label: string;
  readonly diff: Diff;
  readonly metaBefore: unknown;
  readonly metaAfter: unknown;
  readonly origin: TxOrigin;
  readonly mergeKey?: string;
};

/** A record's value across merged diffs: its first before and latest after (undefined: absent). */
type Span = { before: AnyRecord | undefined; after: AnyRecord | undefined };

/** `first` then `next` as one diff: first before, latest after; records that net to nothing drop out. */
function mergeDiffs(first: Diff, next: Diff): Diff {
  const spans = new Map<RecordId, Span>();
  const add = (id: RecordId, before: AnyRecord | undefined, after: AnyRecord | undefined) =>
    spans.set(id, { before: spans.has(id) ? spans.get(id)?.before : before, after });
  for (const diff of [first, next]) {
    for (const [id, { before, after }] of diff.puts) add(id, before, after);
    for (const [id, before] of diff.deletes) add(id, before, undefined);
  }
  return diffOfSpans(spans);
}

/** The diff that takes each span from its before to its after. */
function diffOfSpans(spans: ReadonlyMap<RecordId, Span>): Diff {
  const puts = new Map<RecordId, PutChange>();
  const deletes = new Map<RecordId, AnyRecord>();
  for (const [id, { before, after }] of spans) {
    if (after === undefined) {
      if (before !== undefined) deletes.set(id, before);
    } else if (before === undefined) puts.set(id, { after });
    else if (!jsonEqual(before, after)) puts.set(id, { before, after });
  }
  return { puts, deletes };
}

/** The write access history needs (the store's own transact, origin undo/redo). */
type Transact = <R>(label: string, fn: (tx: Tx) => R, options?: TxOptions) => Result<R, TxFailure>;

const empty = (what: string): Result<never, TxFailure> => err({ code: 'HISTORY_EMPTY', message: `nothing to ${what}`, diagnostics: [] });

/** Write the records `diff` held before (undo) or after (redo). */
function replay(tx: Tx, diff: Diff, direction: 'undo' | 'redo'): void {
  for (const [id, { before, after }] of diff.puts) {
    const target = direction === 'undo' ? before : after;
    if (target) tx.put(target);
    else tx.delete(id);
  }
  for (const [id, before] of diff.deletes) {
    if (direction === 'undo') tx.put(before as AnyRecord);
    else tx.delete(id as RecordId);
  }
}

/** The store's history; `record` is called by the store after each commit (core-internal). */
export class StoreHistory implements History {
  readonly #undo: Entry[] = [];
  readonly #redo: Entry[] = [];
  // batch goes through the store's checked transact; only undo and redo replay (with their
  // reserved origins, skipping hooks) through the unchecked entry point (M4.4 review)
  readonly #store: { readonly transact: Transact };
  readonly #replay: Transact;
  // the entry the next transaction may merge into: the latest one, until another commit or seal()
  #open: Entry | undefined;

  constructor(store: { readonly transact: Transact }, replayTransact: Transact) {
    this.#store = store;
    this.#replay = replayTransact;
  }

  get undoDepth(): number {
    return this.#undo.length;
  }

  get redoDepth(): number {
    return this.#redo.length;
  }

  canUndo(): boolean {
    return this.#undo.length > 0;
  }

  canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /**
   * A committed transaction (non-empty diff; an empty one is never recorded and so never breaks a
   * merge). User and system ones become entries, or merge into the open entry when it has the same
   * mergeKey and origin (ADR-0014 §Merging); any other commit closes the open entry.
   */
  record(diff: Diff, meta: TxMeta): void {
    if (meta.origin !== 'user' && meta.origin !== 'system') {
      this.#open = undefined;
      return;
    }
    this.#redo.length = 0;
    const open = this.#open;
    if (open && meta.mergeKey !== undefined && open.mergeKey === meta.mergeKey && open.origin === meta.origin && this.#undo.at(-1) === open) {
      this.#undo.pop();
      const merged = mergeDiffs(open.diff, diff);
      if (merged.puts.size === 0 && merged.deletes.size === 0) {
        // the gesture ended where it started: no step to undo
        this.#open = undefined;
        return;
      }
      this.#open = { ...open, diff: merged, metaAfter: meta.metaAfter };
      this.#undo.push(this.#open);
      return;
    }
    const entry: Entry = {
      label: meta.label,
      diff,
      metaBefore: meta.metaBefore,
      metaAfter: meta.metaAfter,
      origin: meta.origin,
      ...(meta.mergeKey === undefined ? {} : { mergeKey: meta.mergeKey }),
    };
    this.#undo.push(entry);
    this.#open = entry;
  }

  seal(): void {
    this.#open = undefined;
  }

  batch<R>(label: string, fn: () => R, options?: TxOptions): Result<R, TxFailure> {
    // commands run inside join this transaction (a nested transact is a savepoint)
    return this.#store.transact(label, () => fn(), options);
  }

  undo(): Result<unknown, TxFailure> {
    const entry = this.#undo.at(-1);
    if (!entry) return empty('undo');
    const r = this.#replay(`undo ${entry.label}`, (tx) => replay(tx, entry.diff, 'undo'), { origin: 'undo' });
    if (!r.ok) return r;
    this.#undo.pop();
    this.#redo.push(entry);
    return ok(entry.metaBefore);
  }

  redo(): Result<unknown, TxFailure> {
    const entry = this.#redo.at(-1);
    if (!entry) return empty('redo');
    const r = this.#replay(`redo ${entry.label}`, (tx) => replay(tx, entry.diff, 'redo'), { origin: 'redo' });
    if (!r.ok) return r;
    this.#redo.pop();
    this.#undo.push(entry);
    return ok(entry.metaAfter);
  }
}
