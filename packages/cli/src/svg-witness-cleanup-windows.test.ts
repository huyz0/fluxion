// NFR-SEC-001 (M18.195): on Windows the owned taskkill starts at once (`immediate`), and its verdict follows the evidence, not a
// fixed two-second timer from close: a termination that succeeds after the old reserve is a clean close once the owned process's
// exit is observed (the starved-runner failure of ci 40905801401, reproduced with a slow helper), a failed termination is a cleanup
// failure two seconds after it failed unless the exit follows within them, and a termination that never ends the process fails
// when the session's 120 s lifecycle does. Upper bounds sit well below each lifecycle so a loaded runner does not trip them.
import { type ChildProcess, spawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { createWitnessCleanup } from './svg-witness-cleanup.js';
import { ownBrowserProcess } from './svg-witness-process.js';
import { createWindowsTermination } from './svg-witness-windows.js';

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  vi.restoreAllMocks();
});
/** A long-lived real child standing for the owned browser. */
async function browser(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  children.push(child);
  await new Promise((resolve) => child.once('spawn', resolve));
  return child;
}
/**
 * A termination helper standing for taskkill: a real process spawned with the bound it is given (so Node checks it as it would
 * taskkill's), exiting with `code` after `ms`. It ends `child` when it succeeds, or `endsAfter` ms after it exits when given,
 * so a failure that is followed by the exit happens in that order.
 */
function helper(child: ChildProcess, ms: number, code = 0, endsAfter?: number) {
  const timeouts: unknown[] = [];
  const order: string[] = [];
  child.once('exit', () => order.push('owned-exit'));
  const launch = ((_file: string, _args: readonly string[], options: { timeout?: number }) => {
    timeouts.push(options.timeout);
    const h = spawn(process.execPath, ['-e', `setTimeout(() => process.exit(${code}), ${ms})`], { stdio: 'ignore', timeout: options.timeout });
    children.push(h);
    h.once('exit', () => {
      order.push('helper-exit');
      if (code === 0) child.kill('SIGKILL');
      else if (endsAfter !== undefined) setTimeout(() => child.kill('SIGKILL'), endsAfter);
    });
    return h;
  }) as unknown as typeof spawn;
  return { launch, timeouts, order };
}
/** `child` owned the way `processOwner` owns a Windows browser, under `cleanup`. */
function own(child: ChildProcess, launch: typeof spawn, cleanup = createWitnessCleanup({ lifecycleMs: 20000 })) {
  const owned = {
    pid: child.pid as number,
    get exitCode() {
      return child.exitCode;
    },
    get signalCode() {
      return child.signalCode;
    },
  };
  const windows = createWindowsTermination(owned, launch, '/x', () => cleanup.remaining());
  ownBrowserProcess(
    {
      hasExited: () => child.exitCode !== null || child.signalCode !== null,
      onExit: (listener) => {
        child.once('exit', listener);
        return () => {
          child.removeListener('exit', listener);
        };
      },
      close: windows.kill,
      kill: windows.kill,
      immediate: true,
      stop: windows.stop,
      diagnostics: windows.diagnostics,
    },
    cleanup,
  );
  return cleanup;
}

it('NFR-SEC-001: an immediate termination whose helper succeeds after 2.5 s is a clean close once the owned process exits', async () => {
  const child = await browser();
  const { launch, timeouts } = helper(child, 2500);
  const started = performance.now();
  expect(await own(child, launch).close()).toBe(true);
  expect(child.signalCode).toBe('SIGKILL');
  expect(performance.now() - started).toBeGreaterThan(2400);
  // the helper is bounded by what is left of the session's lifecycle, not by the old two seconds
  expect(timeouts).toHaveLength(1);
  expect(timeouts[0]).toBeGreaterThan(2500);
  expect(Number.isInteger(timeouts[0])).toBe(true);
}, 15000);

it('NFR-SEC-001: an immediate termination whose helper exits non-zero is a cleanup failure two seconds after it, traced, the process untouched', async () => {
  const child = await browser();
  const { launch } = helper(child, 50, 1);
  const lines: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (lines.push(String(chunk)), true));
  const started = performance.now();
  expect(await own(child, launch).close()).toBe(false);
  const took = performance.now() - started;
  expect(took).toBeGreaterThan(1900);
  expect(took).toBeLessThan(10000);
  expect([child.exitCode, child.signalCode]).toEqual([null, null]);
  // the trace names each segment of the helper: when its spawn returned, when and how it exited, and its bound
  const line = lines.find((l) => l.startsWith('WITNESS_CLEANUP '));
  const trace = JSON.parse(line?.slice('WITNESS_CLEANUP '.length) ?? 'null');
  expect(trace).toMatchObject({ decided: 'owned-not-exited', termination: 'failed', helper: { code: 1, signal: null } });
  expect(trace.helper.spawnReturnMs).toBeGreaterThanOrEqual(0);
  expect(trace.helper.exitMs).toBeGreaterThanOrEqual(trace.helper.spawnReturnMs);
  expect(trace.helper.timeout).toBeGreaterThan(2000);
}, 30000);

it('NFR-SEC-001: an immediate termination that never ends the process fails when the session lifecycle ends', async () => {
  const child = await browser();
  // a helper that never returns, under a session whose lifecycle ends 3 s after it started
  const { launch } = helper(child, 60000);
  const started = performance.now();
  expect(await own(child, launch, createWitnessCleanup({ lifecycleMs: 3000 })).close()).toBe(false);
  const took = performance.now() - started;
  expect(took).toBeGreaterThan(2900);
  expect(took).toBeLessThan(15000);
  expect([child.exitCode, child.signalCode]).toEqual([null, null]);
}, 30000);

it('NFR-SEC-001: an immediate termination that fails after the reserve ends the wait two seconds later, not at the lifecycle end', async () => {
  const child = await browser();
  const { launch } = helper(child, 2500, 1);
  const started = performance.now();
  expect(await own(child, launch, createWitnessCleanup({ lifecycleMs: 60000 })).close()).toBe(false);
  const took = performance.now() - started;
  expect(took).toBeGreaterThan(4400);
  expect(took).toBeLessThan(30000);
}, 60000);

it('NFR-SEC-001: a termination that fails after the reserve with the owned exit just behind it is a clean close', async () => {
  const child = await browser();
  // the tree ends a moment after the helper reports failure, as taskkill's 255 did in ci 40858059983
  const { launch, order } = helper(child, 2500, 255, 100);
  expect(await own(child, launch).close()).toBe(true);
  expect(order).toEqual(['helper-exit', 'owned-exit']);
}, 30000);

it('NFR-SEC-001: a taskkill that exits non-zero but has ended the owned process is a clean close (code 255 in ci 40858059983)', async () => {
  const child = await browser();
  const { launch, order } = helper(child, 50, 255, 50);
  expect(await own(child, launch).close()).toBe(true);
  expect(order).toEqual(['helper-exit', 'owned-exit']);
}, 15000);
