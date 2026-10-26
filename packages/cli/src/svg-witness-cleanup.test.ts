import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWitnessCleanup } from './svg-witness-cleanup.js';
import { controlWitness } from './svg-witness-control.js';
import { type OwnedBrowserProcess, ownBrowserProcess } from './svg-witness-process.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function resource() {
  let exited = false;
  const listeners = new Set<() => void>();
  const port: OwnedBrowserProcess = {
    hasExited: () => exited,
    onExit: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    close: vi.fn(async () => {}),
    kill: vi.fn(async () => {}),
  };
  return {
    port,
    listeners,
    exit: (notify = true) => {
      exited = true;
      if (notify) for (const fn of listeners) fn();
    },
  };
}
it('NFR-SEC-001: one cleanup outcome observes status at the cutoff and is shared by controller and owner', async () => {
  const cleanup = createWitnessCleanup();
  const f = resource();
  const owner = ownBrowserProcess(f.port, cleanup);
  const control = controlWitness(cleanup);
  const closed = control.dispose();
  expect(owner.close()).toBe(closed);
  await vi.advanceTimersByTimeAsync(1999);
  f.exit(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await closed).toBe(true);
  expect(await owner.close()).toBe(true);
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: late launch ownership cannot reset the two-second cleanup reserve', async () => {
  const cleanup = createWitnessCleanup();
  cleanup.launchStarted();
  const closed = cleanup.close();
  await vi.advanceTimersByTimeAsync(1500);
  const f = resource();
  const owner = ownBrowserProcess(f.port, cleanup);
  cleanup.launchFinished();
  await vi.advanceTimersByTimeAsync(500);
  expect(await closed).toBe(false);
  expect(await owner.close()).toBe(false);
  expect(f.port.kill).toHaveBeenCalledTimes(1);
  f.exit();
  expect(await owner.close()).toBe(false);
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: launch arriving within the reserve succeeds only on actual exit', async () => {
  const cleanup = createWitnessCleanup();
  cleanup.launchStarted();
  const closed = cleanup.close();
  await vi.advanceTimersByTimeAsync(1500);
  const f = resource();
  ownBrowserProcess(f.port, cleanup);
  cleanup.launchFinished();
  await vi.advanceTimersByTimeAsync(400);
  f.exit();
  expect(await closed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: unresolved launch fails bounded cleanup; later ownership is terminated without rewriting failure', async () => {
  const cleanup = createWitnessCleanup();
  cleanup.launchStarted();
  const closed = cleanup.close();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await closed).toBe(false);
  const f = resource();
  const owner = ownBrowserProcess(f.port, cleanup);
  cleanup.launchFinished();
  await Promise.resolve();
  expect(f.port.kill).toHaveBeenCalledTimes(1);
  f.exit();
  expect(await owner.close()).toBe(false);
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: a rejected launch without a process completes cleanup before the cutoff', async () => {
  const cleanup = createWitnessCleanup();
  cleanup.launchStarted();
  const closed = cleanup.close();
  cleanup.launchFinished();
  expect(await closed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
