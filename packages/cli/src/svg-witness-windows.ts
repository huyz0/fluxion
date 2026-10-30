import { type ChildProcess, spawn } from 'node:child_process';
import { win32 } from 'node:path';

type OwnedChild = { readonly pid?: number; readonly exitCode: number | null; readonly signalCode: string | null };
type WindowsTermination = {
  readonly kill: () => Promise<void>;
  readonly stop: () => void;
  /** The helper's timings (ms from the kill), exit code and signal, for the cleanup-failure trace (M18.195). */
  readonly diagnostics: () => Readonly<Record<string, unknown>>;
};
/** Bypass Playwright's synchronous Windows taskkill, retaining original-child exit as evidence. */
export function createWindowsTermination(
  child: OwnedChild,
  launch: typeof spawn = spawn,
  systemRoot: string | undefined = process.env['SystemRoot'],
  bound: () => number = () => 2000,
): WindowsTermination {
  const pid = child.pid;
  let helper: ChildProcess | undefined;
  let stopped = false;
  let pending: Promise<void> | undefined;
  const seen: { startedAt?: number; spawnReturnMs?: number; exitMs?: number; code?: number | null; signal?: string | null; timeout?: number } = {};
  const since = () => Math.round(performance.now() - (seen.startedAt ?? 0));
  return {
    kill: (): Promise<void> => {
      if (pending) return pending;
      pending = Promise.resolve().then(() => {
        if (stopped || child.exitCode !== null || child.signalCode !== null) return;
        if (!Number.isSafeInteger(pid) || !pid || pid < 1 || !systemRoot || !win32.isAbsolute(systemRoot)) throw Error('invalid owned Windows process');
        return new Promise<void>((resolve, reject) => {
          seen.startedAt = performance.now();
          // bounded by what is left of the session's lifecycle, so a slow but working taskkill is not cut off at two seconds
          seen.timeout = bound();
          helper = launch(win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
            timeout: seen.timeout,
          });
          seen.spawnReturnMs = since();
          helper.once('error', reject);
          helper.once('exit', (code, signal) => {
            Object.assign(seen, { exitMs: since(), code, signal });
            if (code === 0) resolve();
            else reject(Error('owned Windows termination helper failed'));
          });
        });
      });
      return pending;
    },
    diagnostics: () => ({ ...seen, startedAt: undefined }),
    stop: () => {
      stopped = true;
      if (helper && helper.exitCode === null && helper.signalCode === null) helper.kill();
    },
  };
}
