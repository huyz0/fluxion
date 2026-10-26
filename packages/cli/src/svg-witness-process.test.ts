import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type OwnedBrowserProcess, ownBrowserProcess } from './svg-witness-process.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
  let exited = false;
  const listeners = new Set<() => void>();
  const port: OwnedBrowserProcess = {
    hasExited: () => exited,
    onExit: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: vi.fn(async () => {}),
    kill: vi.fn(async () => {}),
  };
  const exit = () => {
    exited = true;
    for (const listener of listeners) listener();
  };
  return { port, exit, listeners };
}
it('NFR-SEC-001: cleanup waits for observed owned-process exit rather than close completion', async () => {
  const f = fixture();
  const owner = ownBrowserProcess(f.port);
  let settled = false;
  const result = owner.close().then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  f.exit();
  expect(await result).toBe(true);
  expect(f.port.kill).not.toHaveBeenCalled();
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: one-second grace kills only the owned server and observes exit within two seconds', async () => {
  const f = fixture();
  const owner = ownBrowserProcess(f.port);
  const result = owner.close();
  expect(owner.close()).toBe(result);
  await vi.advanceTimersByTimeAsync(999);
  expect(f.port.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.port.kill).toHaveBeenCalledTimes(1);
  f.exit();
  expect(await result).toBe(true);
  expect(f.port.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: absent exit after close and kill is a bounded cleanup failure', async () => {
  const f = fixture();
  vi.mocked(f.port.close).mockImplementation(() => new Promise(() => {}));
  vi.mocked(f.port.kill).mockImplementation(async () => {
    throw Error('cannot kill');
  });
  const result = ownBrowserProcess(f.port).close();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await result).toBe(false);
  expect(f.port.kill).toHaveBeenCalledTimes(1);
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: already exited process needs no kill or cleanup timers', async () => {
  const f = fixture();
  f.exit();
  expect(await ownBrowserProcess(f.port).close()).toBe(true);
  expect(f.port.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('NFR-SEC-001: exit reported during subscription releases that subscription without timers', async () => {
  const unsubscribe = vi.fn();
  const port: OwnedBrowserProcess = {
    hasExited: () => false,
    onExit: (listener) => {
      listener();
      return unsubscribe;
    },
    close: vi.fn(async () => {}),
    kill: vi.fn(async () => {}),
  };
  expect(await ownBrowserProcess(port).close()).toBe(true);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(port.close).not.toHaveBeenCalled();
});
it('NFR-SEC-001: exit before the queued kill continuation prevents a late kill', async () => {
  const f = fixture();
  const result = ownBrowserProcess(f.port).close();
  await Promise.resolve();
  vi.advanceTimersByTime(1000);
  f.exit();
  expect(await result).toBe(true);
  await Promise.resolve();
  expect(f.port.kill).not.toHaveBeenCalled();
});
