import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createWindowsTermination } from './svg-witness-windows.js';

function fixture() {
  const child = { pid: 12345, exitCode: null as number | null, signalCode: null };
  const helper = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null, kill: vi.fn() });
  const launch = vi.fn(() => helper) as unknown as typeof spawn;
  const adapter = createWindowsTermination(child, launch, 'C:\\Windows');
  return { child, helper, launch, adapter };
}
it('NFR-SEC-001: Windows termination uses an asynchronous trusted executable and exact owned PID without a shell', async () => {
  const f = fixture();
  const done = f.adapter.kill();
  expect(f.adapter.kill()).toBe(done);
  await Promise.resolve();
  expect(f.launch).toHaveBeenCalledWith('C:\\Windows\\System32\\taskkill.exe', ['/PID', '12345', '/T', '/F'], {
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
    timeout: 2000,
  });
  f.helper.emit('exit', 0);
  await done;
  expect(f.child.exitCode).toBe(null); // helper success is not browser exit
});
it('NFR-SEC-001: browser exit before queued Windows dispatch prevents late PID termination', async () => {
  const f = fixture();
  const done = f.adapter.kill();
  f.child.exitCode = 0;
  await done;
  expect(f.launch).not.toHaveBeenCalled();
});
it('NFR-SEC-001: Windows helper errors and nonzero exits remain failures', async () => {
  for (const event of ['error', 'exit']) {
    const f = fixture();
    const done = f.adapter.kill();
    const rejected = expect(done).rejects.toThrow();
    await Promise.resolve();
    f.helper.emit(event, event === 'error' ? Error('spawn denied') : 9);
    await rejected;
  }
});
it('NFR-SEC-001: invalid owned PID or untrusted relative system root refuses termination', async () => {
  for (const [pid, root] of [
    [0, 'C:\\Windows'],
    [-1, 'C:\\Windows'],
    [1.5, 'C:\\Windows'],
    [123, 'relative'],
  ] as const) {
    const launch = vi.fn() as unknown as typeof spawn;
    const adapter = createWindowsTermination({ pid, exitCode: null, signalCode: null }, launch, root);
    await expect(adapter.kill()).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
  }
});
it('NFR-SEC-001: cleanup stops only its still-running helper and prevents dispatch after stop', async () => {
  const f = fixture();
  const done = f.adapter.kill();
  const rejected = expect(done).rejects.toThrow();
  await Promise.resolve();
  f.adapter.stop();
  expect(f.helper.kill).toHaveBeenCalledTimes(1);
  f.helper.emit('exit', null);
  await rejected;
  const late = fixture();
  const pending = late.adapter.kill();
  late.adapter.stop();
  await pending;
  expect(late.launch).not.toHaveBeenCalled();
});

it('NFR-SEC-001: synchronous spawn refusal is contained and an already exited child never dispatches', async () => {
  const failed = createWindowsTermination(
    { pid: 123, exitCode: null, signalCode: null },
    (() => {
      throw Error('spawn refused');
    }) as unknown as typeof spawn,
    'C:\\Windows',
  );
  await expect(failed.kill()).rejects.toThrow('spawn refused');
  const f = fixture();
  f.child.exitCode = 0;
  await f.adapter.kill();
  expect(f.launch).not.toHaveBeenCalled();
});
