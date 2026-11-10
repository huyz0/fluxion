// NFR-SEC-001 (M18.287): away from Windows, once the grace's kill has been sent without throwing, the cleanup reports what happened:
// a clean close when the owned exit is observed after the two-second reserve, a cleanup failure when no exit is observed by the
// session's 120 s lifecycle end, and a cleanup failure at once when the kill throws (nightly 42596642542, dsl-19).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWitnessCleanup } from './svg-witness-cleanup.js';
import { type OwnedBrowserProcess, ownBrowserProcess } from './svg-witness-process.js';

// time is faked; setImmediate stays real, since the reserve's verdict waits for the loop's I/O of its turn (M18.190)
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const traces = () => {
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return () =>
    write.mock.calls
      .map(([chunk]) => String(chunk))
      .filter((line) => line.startsWith('WITNESS_CLEANUP '))
      .map((line) => JSON.parse(line.slice('WITNESS_CLEANUP '.length)) as Record<string, unknown>);
};
/** A non-Windows owned process: a close that never ends it, and a kill (SIGKILL) given the exit to report whenever its stub ends the process, or never. */
function owned(kill: (exit: () => void) => Promise<void>) {
  let exited = false;
  const listeners = new Set<() => void>();
  const exit = () => {
    exited = true;
    for (const fn of listeners) fn();
  };
  const port: OwnedBrowserProcess = {
    hasExited: () => exited,
    onExit: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    close: vi.fn(() => new Promise<void>(() => {})),
    kill: vi.fn(() => kill(exit)),
  };
  return { port, listeners };
}
function settledValue(closed: Promise<boolean>) {
  const state: { value?: boolean } = {};
  void closed.then((value) => {
    state.value = value;
  });
  return state;
}

it('NFR-SEC-001: a process that exits 1.5 s after its SIGKILL, past the reserve, is a clean close with one trace', async () => {
  const lines = traces();
  const cleanup = createWitnessCleanup();
  // the grace's kill is sent at 1 s; the owned exit is observed at 2.5 s, half a second past the reserve
  const f = owned((exit) => new Promise<void>((resolve) => setTimeout(() => (exit(), resolve()), 1500)));
  ownBrowserProcess(f.port, cleanup);
  const closed = cleanup.close();
  const state = settledValue(closed);
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.value).toBeUndefined();
  await vi.advanceTimersByTimeAsync(500);
  expect(await closed).toBe(true);
  expect(f.port.kill).toHaveBeenCalledTimes(1);
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(lines()).toEqual([
    {
      decided: 'exited-after-reserve',
      closeToExitMs: 2500,
      sinceTerminationMs: 2500,
      expiryToVerdictMs: 500,
      forced: true,
      waitedForExit: true,
      termination: 'running',
      helper: null,
      platform: process.platform,
    },
  ]);
});

it('NFR-SEC-001: a process never seen exiting after its SIGKILL is a cleanup failure at the 120 s lifecycle end, not before', async () => {
  const lines = traces();
  const cleanup = createWitnessCleanup();
  // Playwright's kill resolves only once the process has closed, so a process that never exits leaves it pending
  const f = owned(() => new Promise<void>(() => {}));
  ownBrowserProcess(f.port, cleanup);
  const closed = cleanup.close();
  const state = settledValue(closed);
  await vi.advanceTimersByTimeAsync(119999);
  expect(state.value).toBeUndefined();
  expect(lines()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(await closed).toBe(false);
  expect(f.port.kill).toHaveBeenCalledTimes(1);
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(lines()).toEqual([
    {
      decided: 'owned-not-exited',
      sinceTerminationMs: 120000,
      expiryToVerdictMs: 118000,
      forced: true,
      waitedForExit: true,
      termination: 'running',
      helper: null,
      platform: process.platform,
    },
  ]);
});

it('NFR-SEC-001: a SIGKILL that throws is a cleanup failure at the reserve, with no wait for exit', async () => {
  const lines = traces();
  const cleanup = createWitnessCleanup();
  const f = owned(async () => {
    throw Error('injected kill failure');
  });
  ownBrowserProcess(f.port, cleanup);
  const closed = cleanup.close();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await closed).toBe(false);
  expect(f.port.kill).toHaveBeenCalledTimes(1);
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(lines()).toEqual([
    {
      decided: 'owned-not-exited',
      sinceTerminationMs: 2000,
      expiryToVerdictMs: 0,
      forced: true,
      waitedForExit: false,
      termination: 'failed',
      helper: null,
      platform: process.platform,
    },
  ]);
});

it('NFR-SEC-001: a SIGKILL that throws after the reserve is a cleanup failure at once, not at the lifecycle end', async () => {
  const cleanup = createWitnessCleanup();
  // the kill is sent at 1 s and rejects at 3 s, while the verdict waits for the exit
  const f = owned(() => new Promise<void>((_, reject) => setTimeout(() => reject(Error('injected kill failure')), 2000)));
  ownBrowserProcess(f.port, cleanup);
  const closed = cleanup.close();
  const state = settledValue(closed);
  await vi.advanceTimersByTimeAsync(2999);
  expect(state.value).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(await closed).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
