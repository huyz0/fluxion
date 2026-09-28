// Integrity hook contract (ADR-0014): its own module, so the registry types can name it without
// importing the built-in hooks (no import cycle).
import type { AnyRecord, RecordId } from '@fluxion/schema';
import type { IndexName } from './indexes.js';
import type { Diff, Tx } from './transaction.js';

/**
 * What a hook sees: the transaction, its pending net diff, and index lookups that include the
 * transaction's own writes.
 *
 * @public
 */
export type HookContext = {
  /** The open transaction; hooks write through it. */
  readonly tx: Tx;
  /** The net change so far (the fn's writes plus earlier hooks'). */
  readonly diff: Diff;
  /**
   * Every record deleted in this transaction with its last value, including records created and
   * deleted in it (which the net diff leaves out, but whose children still need the cascade).
   */
  readonly deleted: ReadonlyMap<RecordId, AnyRecord>;
  /** Ids under `key` in `index` as the transaction sees them. */
  members(index: IndexName, key: string): RecordId[];
};

/**
 * An integrity hook. It must write only when something is still inconsistent, so a pass that finds
 * nothing to do writes nothing (the fixed point).
 *
 * @public
 */
export type IntegrityHook = (context: HookContext) => void;
