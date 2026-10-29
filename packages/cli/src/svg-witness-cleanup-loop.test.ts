// NFR-SEC-001: the cleanup reserve's verdict reads the owned browser's exit as the host has it, not as a busy event loop has yet
// handled it (ci 40858059983): an exit that happened inside the reserve is a clean close even when the reserve's timer is run
// before the exit event in the same turn of the loop.
import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { createWitnessCleanup } from './svg-witness-cleanup.js';
import { ownBrowserProcess } from './svg-witness-process.js';

/** Block the event loop for `ms`, as a starved host does: nothing it has queued runs until this returns. */
const block = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

it('NFR-SEC-001: an owned process that exits while the loop is held past the reserve is a clean close', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { stdio: 'ignore' });
  await new Promise((resolve) => child.once('spawn', resolve));
  const cleanup = createWitnessCleanup();
  ownBrowserProcess(
    {
      hasExited: () => child.exitCode !== null || child.signalCode !== null,
      onExit: (listener) => {
        child.once('exit', listener);
        return () => {
          child.removeListener('exit', listener);
        };
      },
      close: async () => {},
      kill: async () => {
        child.kill('SIGKILL');
      },
    },
    cleanup,
  );
  const closed = cleanup.close();
  // the process ends by itself at ~300 ms; its exit is only handled once the loop runs again, after the 2 s reserve has expired
  block(2300);
  expect(await closed).toBe(true);
}, 10000);

it('NFR-SEC-001: a process still running when the held loop resumes past the reserve is a cleanup failure one loop turn later', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  await new Promise((resolve) => child.once('spawn', resolve));
  try {
    const cleanup = createWitnessCleanup();
    ownBrowserProcess(
      {
        hasExited: () => child.exitCode !== null || child.signalCode !== null,
        onExit: (listener) => {
          child.once('exit', listener);
          return () => {
            child.removeListener('exit', listener);
          };
        },
        close: async () => {},
        kill: async () => {},
      },
      cleanup,
    );
    let verdict: boolean | undefined;
    void cleanup.close().then((closed) => {
      verdict = closed;
    });
    block(2300);
    // the verdict is read in the turn the reserve expires in, after its I/O, with no timer of its own: it is in by a few
    // immediates after the loop resumes, never a timer period later
    const resumed = performance.now();
    while (verdict === undefined && performance.now() - resumed < 1000) await new Promise((resolve) => setImmediate(resolve));
    expect(performance.now() - resumed).toBeLessThan(100);
    expect(verdict).toBe(false);
  } finally {
    child.kill('SIGKILL');
  }
}, 10000);
