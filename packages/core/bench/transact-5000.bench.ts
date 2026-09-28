// NFR-PERF-006: the forward transaction of every built-in command on a 5 000-record document with
// validation on (default options; ADR-0014 Consequences), p99 held to UNDO_MAX_MS by the
// m3-complete bench leg. Each iteration runs the command; the untimed afterEach undoes it.
// `async: false`: tinybench would otherwise call the function once, outside the hooks, to detect it.
import { describe, test } from 'vitest';
import { benchStore, COMMANDS } from './fixture.js';

describe('transact on 5 000 records (NFR-PERF-006)', () => {
  for (const command of COMMANDS) {
    test(`NFR-PERF-006: transact ${command}`, async ({ bench }) => {
      const { store, run } = benchStore();
      await bench(
        `transact ${command}`,
        {
          async: false,
          afterEach: () => {
            if (!store.history.undo().ok) throw new Error(`${command}: undo refused`);
          },
        },
        () => run(command),
      ).run();
    });
  }
});
