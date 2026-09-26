#!/usr/bin/env node
// The single definition of the pre-commit ladder. Used by .githooks/pre-commit (--staged),
// by `pnpm verify` / CI (--all), and by agents (--quick while iterating).
//   --staged     check what is staged (default when run from the hook)
//   --all        whole repo (CI)
//   --quick      fast subset for iteration
//   --summary    one line per step only
//   --no-review  skip check-reviewed (used when building the review packet)
// check-tests-kept runs from the commit-msg hook (it needs the Removes-test trailer).
// Steps whose tooling does not exist yet print SKIP with the reason — never a silent pass.
import { exists, node, run } from './lib.mjs';
import { t } from './thresholds.mjs';

const argv = new Set(process.argv.slice(2));
const mode = argv.has('--all') ? 'all' : argv.has('--quick') ? 'quick' : 'staged';
const hasPkg = exists('package.json') && exists('turbo.json');
const pnpm = (...a) => run('pnpm', a);

/** name, applies(mode), available() → true | skip-reason, exec() → {status, stdout, stderr} */
const STEPS = [
  ['skills-sync', () => true, () => true, () => node('scripts/harness/sync-skills.mjs', ['--check'])],
  ['portability', () => true, () => true, () => node('scripts/gates/check-portability.mjs')],
  ['size', () => true, () => exists('scripts/gates/check-size.mjs') || 'check-size.mjs not written yet (M0)', () => node('scripts/gates/check-size.mjs', [`--${mode}`])],
  ['harness-tests', (m) => m !== 'quick', () => exists('tests/harness') || 'tests/harness not written yet (M0)', () => run(process.execPath, ['--test', 'tests/harness/*.test.mjs'])],
  ['drift', (m) => m !== 'quick', () => exists('scripts/gates/check-drift.mjs') || 'not written yet (M0)', () => node('scripts/gates/check-drift.mjs', [`--${mode}`])],
  ['typecheck', () => true, () => hasPkg || 'no workspace yet (M1)', () => pnpm('turbo', 'run', 'typecheck', ...(mode === 'all' ? [] : ['--affected']))],
  ['lint', () => true, () => hasPkg || 'no workspace yet (M1)', () => pnpm('biome', 'ci', '.')],
  ['test', () => true, () => hasPkg || 'no workspace yet (M1)', () => pnpm('turbo', 'run', mode === 'quick' ? 'test:related' : 'test:coverage', ...(mode === 'all' ? [] : ['--affected']))],
  ['layering', (m) => m !== 'quick', () => exists('scripts/gates/check-layering.mjs') || 'not written yet (M1)', () => node('scripts/gates/check-layering.mjs')],
  ['licenses', (m) => m !== 'quick', () => exists('scripts/gates/check-licenses.mjs') || 'not written yet (M1)', () => node('scripts/gates/check-licenses.mjs')],
  ['trace', (m) => m !== 'quick', () => exists('scripts/gates/check-trace.mjs') || 'not written yet (M1)', () => node('scripts/gates/check-trace.mjs')],
  ['api', (m) => m !== 'quick', () => exists('scripts/gates/check-api.mjs') || 'not written yet (M1)', () => node('scripts/gates/check-api.mjs')],
  ['reviewed', (m) => m === 'staged' && !argv.has('--no-review'), () => true, () => node('scripts/gates/check-reviewed.mjs')],
];

const started = Date.now();
let failed = false;
const lines = [];
for (const [name, applies, available, exec] of STEPS) {
  if (!applies(mode)) continue;
  const avail = available();
  if (avail !== true) { lines.push(`SKIP ${name} — ${avail}`); continue; }
  const t0 = Date.now();
  const r = exec();
  const ms = Date.now() - t0;
  if (r.status === 0) lines.push(`PASS ${name} (${ms}ms)`);
  else {
    failed = true;
    lines.push(`FAIL ${name} (${ms}ms)`);
    if (!argv.has('--summary')) lines.push(...`${r.stdout}\n${r.stderr}`.trim().split(/\r?\n/).slice(-40).map((l) => `    ${l}`));
  }
}
const total = Date.now() - started;
const budget = mode === 'quick' ? t('QUICK_GATE_BUDGET_MS') : t('PRECOMMIT_BUDGET_MS');
if (mode !== 'all' && total > budget) { failed = true; lines.push(`FAIL budget — ${total}ms > ${budget}ms (NFR-DX-002)`); }
for (const l of lines) console.log(l);
console.log(`VERIFY ${mode}: ${failed ? 'FAIL' : 'PASS'} (${(total / 1000).toFixed(1)}s)`);
process.exit(failed ? 1 : 0);
