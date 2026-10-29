import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createWitnessCleanup } from './svg-witness-cleanup.js';
import type { Browser, BrowserServer } from './svg-witness-driver.js';
import { connectWitnessBrowser, processOwner, type WitnessBrowserDriver } from './svg-witness-launch.js';
import { createWindowsTermination } from './svg-witness-windows.js';

vi.mock('./svg-witness-windows.js', () => ({
  createWindowsTermination: vi.fn((child: EventEmitter & { exitCode: number | null }) => ({
    kill: vi.fn(async () => {
      child.exitCode = 0;
      child.emit('exit', 0);
    }),
    stop: vi.fn(),
  })),
}));

function fixture() {
  const events = new EventEmitter();
  const process = Object.assign(events, {
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn(() => {
      process.exitCode = 1;
      events.emit('exit', 1);
      return true;
    }),
  });
  const server = {
    wsEndpoint: () => 'ws://127.0.0.1:12345/generated-secret',
    process: () => process,
    close: vi.fn(async () => {
      process.exitCode = 0;
      events.emit('exit', 0);
    }),
    kill: vi.fn(async () => {
      process.exitCode = 1;
      events.emit('exit', 1);
    }),
  } as unknown as BrowserServer;
  const browser = {} as Browser;
  const driver: WitnessBrowserDriver = {
    launchServer: vi.fn(async () => server),
    connect: vi.fn(async () => browser),
  };
  return { driver, server, browser, process };
}
it('NFR-SEC-001: Node witness launches only loopback ephemeral server and connects its exact generated endpoint', async () => {
  const f = fixture();
  const owned = vi.fn();
  const result = await connectWitnessBrowser(f.driver, { alive: () => true, own: owned });
  expect(f.driver.launchServer).toHaveBeenCalledWith({ host: '127.0.0.1', port: 0, headless: true, timeout: 10000 });
  expect(f.driver.connect).toHaveBeenCalledWith(f.server.wsEndpoint(), { timeout: 10000 });
  expect(owned).toHaveBeenCalledTimes(1);
  expect(result.browser).toBe(f.browser);
  expect(await result.close()).toBe(true);
  expect(f.server.kill).not.toHaveBeenCalled();
});
it('NFR-SEC-001: rejected non-loopback endpoint is never connected and its owned server closes', async () => {
  const f = fixture();
  vi.spyOn(f.server, 'wsEndpoint').mockReturnValue('ws://example.com:12345/token');
  await expect(connectWitnessBrowser(f.driver, { alive: () => true, own: vi.fn() })).rejects.toThrow('endpoint');
  expect(f.driver.connect).not.toHaveBeenCalled();
  expect(f.process.exitCode).toBe(0);
  expect(f.server.close).toHaveBeenCalledTimes(process.platform === 'win32' ? 0 : 1);
});
it('NFR-SEC-001: cancellation after server launch prevents late connection and closes the server', async () => {
  const f = fixture();
  let alive = true;
  await expect(
    connectWitnessBrowser(f.driver, {
      alive: () => alive,
      own: () => {
        alive = false;
      },
    }),
  ).rejects.toThrow('cancelled');
  expect(f.driver.connect).not.toHaveBeenCalled();
  expect(f.process.exitCode).toBe(0);
  expect(f.server.close).toHaveBeenCalledTimes(process.platform === 'win32' ? 0 : 1);
});
it('NFR-SEC-001: connection failure observes owned-process exit before propagating failure', async () => {
  const f = fixture();
  vi.mocked(f.driver.connect).mockRejectedValue(Error('connection failed'));
  await expect(connectWitnessBrowser(f.driver, { alive: () => true, own: vi.fn() })).rejects.toThrow('connection failed');
  expect(f.process.exitCode).toBe(0);
  expect(f.server.close).toHaveBeenCalledTimes(process.platform === 'win32' ? 0 : 1);
});

it('NFR-SEC-001: Windows ownership bypasses both synchronous Playwright shutdown paths', async () => {
  const f = fixture();
  const cleanup = createWitnessCleanup();
  const owner = processOwner(f.server, cleanup, 'win32');
  expect(await owner.close()).toBe(true);
  expect(createWindowsTermination).toHaveBeenCalledWith(f.process);
  expect(f.server.close).not.toHaveBeenCalled();
  expect(f.server.kill).not.toHaveBeenCalled();
  expect(f.process.exitCode).toBe(0);
});

it('NFR-SEC-001: on Windows a tree termination that has not ended the browser by the grace ends its own process directly, inside the reserve', async () => {
  const f = fixture();
  // the taskkill helper is still running (a loaded host): it has neither ended the browser nor exited (ci 40837280675)
  vi.mocked(createWindowsTermination).mockReturnValueOnce({ kill: vi.fn(() => new Promise<void>(() => {})), stop: vi.fn() });
  const started = performance.now();
  const owner = processOwner(f.server, createWitnessCleanup(), 'win32');
  expect(await owner.close()).toBe(true);
  expect(f.process.kill).toHaveBeenCalledWith('SIGKILL');
  expect(performance.now() - started).toBeLessThan(2000);
  expect(f.server.close).not.toHaveBeenCalled();
  expect(f.server.kill).not.toHaveBeenCalled();
});

it('NFR-SEC-001: on Windows a tree termination that ends the browser in time never terminates it again', async () => {
  const f = fixture();
  const owner = processOwner(f.server, createWitnessCleanup(), 'win32');
  expect(await owner.close()).toBe(true);
  expect(f.process.kill).not.toHaveBeenCalled();
});
