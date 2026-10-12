// NFR-PERF-006: the bench fixture's arguments really change the document, so no bench times a no-op: every built-in
// command leaves one undoable history step, undo and redo both succeed, and it can run again after its undo.
// The fixture lives outside this package's tsconfig `src` root, so it is imported by a computed specifier.
import { describe, expect, it } from 'vitest';
import type { Store } from './store.js';

type Fixture = { benchStore(): { store: Store; run(command: string): void }; COMMANDS: readonly string[] };
const FIXTURE: string = '../bench/fixture.js';
const { benchStore, COMMANDS } = (await import(/* @vite-ignore */ FIXTURE)) as Fixture;

describe('bench fixture (NFR-PERF-006)', () => {
  for (const command of COMMANDS) {
    it(`NFR-PERF-006: ${command} records an undoable step, twice in a row`, () => {
      const { store, run } = benchStore();
      for (let round = 0; round < 2; round++) {
        run(command);
        expect(store.history.canUndo(), `${command} left no history entry (a no-op)`).toBe(true);
        expect(store.history.undo().ok).toBe(true);
        expect(store.history.redo().ok).toBe(true);
        expect(store.history.undo().ok).toBe(true);
      }
    });
  }
});
