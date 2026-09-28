// The CLI e2e suites spawn the built bin (packages/cli/dist/bin.js), never the sources.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The built bin; the ladder and CI build before testing (`pnpm run build`). */
export const BIN: string = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));
/** The repository root. */
export const REPO: string = fileURLToPath(new URL('../../../../', import.meta.url));

/** Runs the built bin with `args` in `cwd` (default: the repo root). */
export function fluxion(args: readonly string[], cwd: string = REPO): { status: number | null; stdout: string; stderr: string } {
  if (!existsSync(BIN)) throw new Error(`${BIN} is missing: run pnpm run build first`);
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
