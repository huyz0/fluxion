import type { WitnessCleanup } from './svg-witness-cleanup.js';
import type { Browser, BrowserServer } from './svg-witness-driver.js';
import { type BrowserProcessOwner, ownBrowserProcess } from './svg-witness-process.js';
import { createWindowsTermination } from './svg-witness-windows.js';

export type WitnessBrowserKind = 'chromium' | 'firefox' | 'webkit';
export type WitnessBrowserDriver = {
  readonly launchServer: (options: { host: string; port: number; headless: boolean; timeout: number }) => Promise<BrowserServer>;
  readonly connect: (endpoint: string, options: { timeout: number }) => Promise<Browser>;
};
export type WitnessBrowserScope = { readonly cleanup?: WitnessCleanup; readonly alive: () => boolean; readonly own: (owner: BrowserProcessOwner) => void };
export type WitnessBrowserConnection = BrowserProcessOwner & { readonly browser: Browser };

/** Optional peer lookup; no browser launch or peer import during module initialization. */
export async function loadWitnessDriver(kind: WitnessBrowserKind): Promise<WitnessBrowserDriver> {
  const name = 'playwright';
  const peers = (await import(name)) as Record<WitnessBrowserKind, WitnessBrowserDriver>;
  return peers[kind];
}
export function processOwner(server: BrowserServer, cleanup?: WitnessCleanup, platform: NodeJS.Platform = process.platform): BrowserProcessOwner {
  const child = server.process();
  const windows = platform === 'win32' ? createWindowsTermination(child, undefined, undefined, () => cleanup?.remaining() ?? 2000) : undefined;
  return ownBrowserProcess(
    {
      hasExited: () => child.exitCode !== null || child.signalCode !== null,
      onExit: (listener) => {
        child.once('exit', listener);
        return () => {
          child.removeListener('exit', listener);
        };
      },
      close: windows ? windows.kill : () => server.close(),
      kill: windows ? windows.kill : () => server.kill(),
      ...(windows ? { immediate: true, stop: windows.stop, diagnostics: windows.diagnostics } : {}),
    },
    cleanup,
  );
}
function endpoint(server: BrowserServer): string {
  const value = server.wsEndpoint();
  const url = new URL(value);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) throw Error('invalid owned browser endpoint');
  return value;
}
/** Register ownership before connecting; a late launch after cancellation can only close. */
export async function connectWitnessBrowser(driver: WitnessBrowserDriver, scope: WitnessBrowserScope): Promise<WitnessBrowserConnection> {
  if (!scope.alive()) throw Error('cancelled browser launch');
  const server = await driver.launchServer({ host: '127.0.0.1', port: 0, headless: true, timeout: 10000 });
  const owner = processOwner(server, scope.cleanup);
  try {
    scope.own(owner);
    if (!scope.alive()) throw Error('cancelled browser connection');
    const browser = await driver.connect(endpoint(server), { timeout: 10000 });
    if (!scope.alive()) throw Error('cancelled browser connection');
    return { browser, close: owner.close };
  } catch (cause) {
    if (!(await owner.close())) throw Object.assign(Error('owned browser cleanup failed', { cause }), { kind: 'cleanup' });
    throw Object.assign(Error(cause instanceof Error ? cause.message : 'browser connection failed', { cause }), {
      kind: scope.alive() ? 'transport' : 'cancelled',
    });
  }
}
