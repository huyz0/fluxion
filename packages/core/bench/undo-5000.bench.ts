// NFR-PERF-006: undo and redo of every built-in command on a 5 000-record document, validation on
// (default options); the shared bench leg of every completion gate holds each p99 to UNDO_MAX_MS. Only the undo (or
// redo) is timed: beforeEach puts the command's entry on top of the history before each iteration.
// `async: false`: tinybench would otherwise call the function once, outside the hooks, to detect it.
import { describe, test } from 'vitest';
import { benchStore, COMMANDS, RUN_OPTIONS } from './fixture.js';

describe('undo on 5 000 records (NFR-PERF-006)', () => {
  for (const command of COMMANDS) {
    test(`NFR-PERF-006: undo and redo ${command}`, async ({ bench }) => {
      const { store, run } = benchStore();
      const check = (ok: boolean) => {
        if (!ok) throw new Error(`${command}: history step refused`);
      };
      await bench(
        `undo ${command}`,
        // the entry is on the redo stack after the previous iteration, or not yet recorded at all
        { async: false, beforeEach: () => (store.history.canRedo() ? check(store.history.redo().ok) : run(command)) },
        () => check(store.history.undo().ok),
      ).run(RUN_OPTIONS);
      await bench(
        `redo ${command}`,
        {
          async: false,
          beforeEach: () => {
            if (!store.history.canUndo()) run(command);
            check(store.history.undo().ok);
          },
        },
        () => check(store.history.redo().ok),
      ).run(RUN_OPTIONS);
    });
  }
});
