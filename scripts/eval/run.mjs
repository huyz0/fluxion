// `pnpm eval --recorded | --live | --author` (ADR-0039). Recorded replays eval/recordings through the real pipeline and writes eval/out/scorecard.{json,md};
// `--author` first rewrites the scripted cases; `--live` calls a provider and arrives with the adapters (M15.19).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const mode = process.argv[2] ?? '--recorded';
if (mode === '--live') {
  console.error('eval --live needs the provider adapters (M15.19); use --recorded');
  process.exit(2);
}
if (mode !== '--recorded' && mode !== '--author') {
  console.error('usage: pnpm eval --recorded | --author | --live');
  process.exit(2);
}
const root = join(import.meta.dirname, '..', '..');
const r = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', 'scripts/eval/eval.config.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ...(mode === '--author' ? { EVAL_AUTHOR: '1' } : {}) },
});
if (mode === '--author' && r.status === 0)
  spawnSync('pnpm', ['exec', 'biome', 'format', '--write', 'eval/cases', 'eval/recordings'], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
