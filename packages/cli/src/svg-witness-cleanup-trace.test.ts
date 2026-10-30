// NFR-SEC-001 (M18.195): a cleanup failure prints one WITNESS_CLEANUP line naming the branch that decided it, the time since the
// owned termination started and the time from the reserve's expiry to the verdict; a clean close prints nothing.
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
function stuck(immediate?: true): OwnedBrowserProcess {
  return { hasExited: () => false, onExit: () => () => {}, close: vi.fn(async () => {}), kill: vi.fn(async () => {}), ...(immediate ? { immediate } : {}) };
}

it('NFR-SEC-001: an owned process that has not exited at the reserve prints one trace naming that branch and its times', async () => {
  const lines = traces();
  const cleanup = createWitnessCleanup();
  ownBrowserProcess(stuck(), cleanup);
  const closed = cleanup.close();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await closed).toBe(false);
  expect(lines()).toEqual([
    {
      decided: 'owned-not-exited',
      sinceTerminationMs: 2000,
      expiryToVerdictMs: 0,
      forced: true,
      waitedForExit: false,
      termination: 'none',
      helper: null,
      platform: process.platform,
    },
  ]);
});

it('NFR-SEC-001: on Windows, where the owned taskkill starts at once, the trace times it from that start and shows the wait for exit', async () => {
  const lines = traces();
  // the owned taskkill succeeds but the process never exits: the verdict waits for the exit until the lifecycle ends (M18.195)
  const cleanup = createWitnessCleanup({ lifecycleMs: 5000 });
  const resource = stuck(true);
  ownBrowserProcess(resource, cleanup);
  const closed = cleanup.close();
  await vi.advanceTimersByTimeAsync(2000);
  expect(lines()).toEqual([]);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await closed).toBe(false);
  expect(resource.kill).toHaveBeenCalledTimes(1);
  expect(resource.close).not.toHaveBeenCalled();
  expect(lines()).toEqual([
    {
      decided: 'owned-not-exited',
      sinceTerminationMs: 5000,
      expiryToVerdictMs: 3000,
      forced: true,
      waitedForExit: true,
      termination: 'done',
      helper: null,
      platform: process.platform,
    },
  ]);
});

it('NFR-SEC-001: the two-second window after a failed Windows termination never runs past the lifecycle end', async () => {
  const lines = traces();
  // the owned taskkill fails 1 s before the 5 s lifecycle ends: the verdict comes at the lifecycle end, not 2 s after the failure
  const cleanup = createWitnessCleanup({ lifecycleMs: 5000 });
  const resource = {
    ...stuck(true),
    kill: vi.fn(() => new Promise<void>((_, reject) => setTimeout(() => reject(Error('taskkill exited 1')), 4000))),
  };
  ownBrowserProcess(resource, cleanup);
  const closed = cleanup.close();
  await vi.advanceTimersByTimeAsync(4999);
  expect(lines()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(await closed).toBe(false);
  expect(lines()).toMatchObject([{ sinceTerminationMs: 5000, expiryToVerdictMs: 3000, waitedForExit: true, termination: 'failed' }]);
});

it('NFR-SEC-001: a termination that rejects after the cleanup settled arms no timer (M18.198)', async () => {
  const lines = traces();
  const cleanup = createWitnessCleanup({ lifecycleMs: 60000 });
  let exit = () => {};
  let rejectKill = (_cause: Error) => {};
  // the owned exit is observed while taskkill still runs; settling stops the helper, which then rejects the termination
  const resource: OwnedBrowserProcess = {
    ...stuck(true),
    onExit: (listener) => {
      exit = listener;
      return () => {};
    },
    kill: vi.fn(() => new Promise<void>((_, reject) => (rejectKill = reject))),
    stop: () => rejectKill(Error('taskkill stopped')),
  };
  ownBrowserProcess(resource, cleanup);
  const closed = cleanup.close();
  await vi.advanceTimersByTimeAsync(3000);
  exit();
  expect(await closed).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  // the exit came after the reserve, so the close is traced as a slow clean one (M18.201), and nothing else is
  expect(lines()).toMatchObject([{ decided: 'exited-after-reserve', closeToExitMs: 3000, waitedForExit: true }]);
});

it('NFR-SEC-001: a launch still pending with no owned process at the reserve prints one trace naming that branch', async () => {
  const lines = traces();
  const cleanup = createWitnessCleanup();
  cleanup.launchStarted();
  const closed = cleanup.close();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await closed).toBe(false);
  expect(lines()).toEqual([
    {
      decided: 'launch-pending',
      sinceTerminationMs: null,
      expiryToVerdictMs: 0,
      forced: false,
      waitedForExit: false,
      termination: 'none',
      helper: null,
      platform: process.platform,
    },
  ]);
});

it('NFR-SEC-001: a clean close prints no trace', async () => {
  const lines = traces();
  const cleanup = createWitnessCleanup();
  let exited = false;
  const listeners = new Set<() => void>();
  ownBrowserProcess(
    {
      hasExited: () => exited,
      onExit: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      close: async () => {
        exited = true;
        for (const fn of listeners) fn();
      },
      kill: async () => {},
    },
    cleanup,
  );
  expect(await cleanup.close()).toBe(true);
  expect(lines()).toEqual([]);
});
