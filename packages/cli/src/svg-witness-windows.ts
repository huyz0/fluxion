import { type ChildProcess, spawn } from 'node:child_process';
import { win32 } from 'node:path';

type OwnedChild = { readonly pid?: number; readonly exitCode: number | null; readonly signalCode: string | null };
type WindowsTermination = { readonly kill: () => Promise<void>; readonly stop: () => void };
/** Bypass Playwright's synchronous Windows taskkill, retaining original-child exit as evidence. */
export function createWindowsTermination(
  child: OwnedChild,
  launch: typeof spawn = spawn,
  systemRoot: string | undefined = process.env['SystemRoot'],
): WindowsTermination {
  const pid = child.pid;
  let helper: ChildProcess | undefined;
  let stopped = false;
  let pending: Promise<void> | undefined;
  return {
    kill: (): Promise<void> => {
      if (pending) return pending;
      pending = Promise.resolve().then(() => {
        if (stopped || child.exitCode !== null || child.signalCode !== null) return;
        if (!Number.isSafeInteger(pid) || !pid || pid < 1 || !systemRoot || !win32.isAbsolute(systemRoot)) throw Error('invalid owned Windows process');
        return new Promise<void>((resolve, reject) => {
          helper = launch(win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
            timeout: 2000,
          });
          helper.once('error', reject);
          helper.once('exit', (code) => (code === 0 ? resolve() : reject(Error('owned Windows termination helper failed'))));
        });
      });
      return pending;
    },
    stop: () => {
      stopped = true;
      if (helper && helper.exitCode === null && helper.signalCode === null) helper.kill();
    },
  };
}
