// Which ladder steps are running, kept where a job killed at its step timeout still shows it (M20.31, cp2 F3): the ladder prints
// its results only at the end, so a verify step timed out at 6185580 left no line naming the stage it was in.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Track running steps: `start(name)` / `end(name)` rewrite `file` (JSON: `{ at, running: [{ step, ms }] }`) and print a
 * `ladder: running ...` line every `every` ms while any step runs; `done()` stops the heartbeat and removes `file`, so the
 * stuck-build artifact holds one only when the ladder never finished. Clock, printer and writer are injectable for tests.
 */
export function runningSteps(
  file,
  {
    every = 120_000,
    now = Date.now,
    print = console.log,
    write = (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    remove = (path) => rmSync(path, { force: true }),
    timer = (fn, ms) => setInterval(fn, ms).unref(),
    clear = clearInterval,
  } = {},
) {
  const open = new Map();
  const snapshot = () => [...open].map(([step, t0]) => ({ step, ms: now() - t0 }));
  const save = () => {
    try {
      write(file, `${JSON.stringify({ at: new Date(now()).toISOString(), running: snapshot() })}\n`);
    } catch {
      // a capture that cannot be written never fails the ladder
    }
  };
  const beat = () => {
    if (open.size)
      print(
        `ladder: running ${snapshot()
          .map((r) => `${r.step} (${Math.round(r.ms / 1000)} s)`)
          .join(', ')}`,
      );
    save();
  };
  const handle = timer(beat, every);
  return {
    start(step) {
      open.set(step, now());
      save();
    },
    end(step) {
      open.delete(step);
      save();
    },
    snapshot,
    done() {
      clear(handle);
      try {
        remove(file);
      } catch {
        // as save
      }
    },
  };
}
