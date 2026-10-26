import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { controlWitness } from './svg-witness-control.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it('NFR-SEC-001: Node lifetime reserves its final two seconds for owned-process cleanup', async () => {
  const cleanup = vi.fn(async () => true);
  const control = controlWitness(cleanup);
  await vi.advanceTimersByTimeAsync(117999);
  expect(cleanup).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(control.alive()).toBe(false);
  expect(await control.run(async () => 'late')).toEqual({ ok: false, kind: 'deadline' });
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: a bounded request cannot publish a late result after its deadline', async () => {
  let finish: ((value: string) => void) | undefined;
  const control = controlWitness(async () => true);
  const pending = control.run(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(10000);
  expect(await pending).toEqual({ ok: false, kind: 'deadline' });
  finish?.('late');
  expect(await control.run(async () => 'another')).toEqual({ ok: false, kind: 'deadline' });
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: concurrent refusal preserves the first operation and does not close its process', async () => {
  let finish: ((value: string) => void) | undefined;
  const cleanup = vi.fn(async () => true);
  const control = controlWitness(cleanup);
  const first = control.run(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  expect(await control.run(async () => 'second')).toEqual({ ok: false, kind: 'busy' });
  expect(cleanup).not.toHaveBeenCalled();
  finish?.('first');
  expect(await first).toEqual({ ok: true, value: 'first' });
  expect(await control.dispose()).toBe(true);
});
it('NFR-SEC-001: abort waits for cleanup and surfaces a bounded cleanup failure', async () => {
  const signal = new AbortController();
  const control = controlWitness(() => new Promise(() => {}), signal.signal);
  const pending = control.run(() => new Promise(() => {}));
  signal.abort();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toEqual({ ok: false, kind: 'cleanup' });
  expect(await control.dispose()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: native operation failure closes the process and remains distinct from cleanup failure', async () => {
  const cleanup = vi.fn(async () => true);
  const control = controlWitness(cleanup);
  expect(
    await control.run(async () => {
      throw Error('transport');
    }),
  ).toEqual({ ok: false, kind: 'transport' });
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: immediate cancellation prevents queued resource initialization', async () => {
  const signal = new AbortController();
  const work = vi.fn(async () => 'resource');
  const control = controlWitness(async () => true, signal.signal);
  const pending = control.run(work);
  signal.abort();
  expect(await pending).toEqual({ ok: false, kind: 'cancelled' });
  expect(work).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
