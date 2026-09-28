// Applying a fork to its parent (ADR-0014 §Forks): one of the two modules ADR-0014 lets call
// transact directly. A fork is a preview (an AI patch, a dry run); applying it writes the fork's
// own net change into the parent as one user transaction, so it is one undo step there.
import { err, type Result } from '@fluxion/schema';
import type { Store } from './store.js';
import type { Diff, TxFailure, TxOptions } from './transaction.js';

/**
 * Write `fork`'s changes since it was forked into `parent` as one transaction (user origin unless
 * `options` says otherwise). The diff is taken against the fork-time snapshot, so records the parent
 * changed meanwhile and the fork did not are kept; where both changed a record, the fork's value
 * wins. Validation and hooks run as for any transaction; on failure the parent is unchanged.
 *
 * @public
 */
export function applyFork(parent: Store, fork: Store, label = 'apply fork', options: TxOptions = {}): Result<Diff, TxFailure> {
  const diff = fork.diffFrom(parent);
  if (!diff) return err({ code: 'TX_INVALID', message: `${label}: the store is not a fork of the parent`, diagnostics: [] });
  return parent.transact(
    label,
    (tx) => {
      for (const [, { after }] of diff.puts) tx.put(after);
      for (const id of diff.deletes.keys()) tx.delete(id);
      return diff;
    },
    options,
  );
}
