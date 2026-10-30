// The CLI e2e suites spawn the built bin (packages/cli/dist/bin.js), never the sources.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The built bin; the ladder and CI build before testing (`pnpm run build`). */
export const BIN: string = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));
/** The repository root. */
export const REPO: string = fileURLToPath(new URL('../../../../', import.meta.url));

/** Runs the built bin with `args` in `cwd` (default: the repo root). */
export function fluxion(
  args: readonly string[],
  cwd: string = REPO,
  env: NodeJS.ProcessEnv = process.env,
): { status: number | null; stdout: string; stderr: string } {
  if (!existsSync(BIN)) throw new Error(`${BIN} is missing: run pnpm run build first`);
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Per-test timeout of the e2e suites: each case spawns Node several times, slow on a loaded machine. */
export const E2E_TIMEOUT = 30_000;

/**
 * The CLI's WITNESS_CLEANUP stderr lines as `ADVISORY ` lines: verify shows those on a passing step and ci raises them as warnings,
 * so a slow but clean witness close reaches a green ci log (M18.201). Written to stdout, which vitest does not silence.
 */
export function witnessAdvisories(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .filter((line) => line.startsWith('WITNESS_CLEANUP '))
    .map((line) => `ADVISORY witness-cleanup ${line}`);
}
