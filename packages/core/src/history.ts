// Undo/redo (ADR-0014 §History): entries are the committed diffs of user and system transactions
// plus the caller's opaque metaBefore/metaAfter; undo applies an entry's inverse and redo re-applies
// it, both through transact (origin undo/redo: validated, not re-recorded, hooks skipped). One of the
// two modules ADR-0014 lets call transact directly.
import { type AnyRecord, err, ok, type RecordId, type Result } from '@fluxion/schema';
import type { Diff, Tx, TxFailure, TxMeta, TxOptions } from './transaction.js';

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
}

/** One undo step. */
type Entry = {
  readonly label: string;
  readonly diff: Diff;
  readonly metaBefore: unknown;
  readonly metaAfter: unknown;
};

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
  readonly #transact: Transact;

  constructor(transact: Transact) {
    this.#transact = transact;
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

  /** A committed transaction: user and system ones become entries and clear the redo stack. */
  record(diff: Diff, meta: TxMeta): void {
    if (meta.origin !== 'user' && meta.origin !== 'system') return;
    this.#undo.push({ label: meta.label, diff, metaBefore: meta.metaBefore, metaAfter: meta.metaAfter });
    this.#redo.length = 0;
  }

  undo(): Result<unknown, TxFailure> {
    const entry = this.#undo.at(-1);
    if (!entry) return empty('undo');
    const r = this.#transact(`undo ${entry.label}`, (tx) => replay(tx, entry.diff, 'undo'), { origin: 'undo' });
    if (!r.ok) return r;
    this.#undo.pop();
    this.#redo.push(entry);
    return ok(entry.metaBefore);
  }

  redo(): Result<unknown, TxFailure> {
    const entry = this.#redo.at(-1);
    if (!entry) return empty('redo');
    const r = this.#transact(`redo ${entry.label}`, (tx) => replay(tx, entry.diff, 'redo'), { origin: 'redo' });
    if (!r.ok) return r;
    this.#redo.pop();
    this.#undo.push(entry);
    return ok(entry.metaAfter);
  }
}
