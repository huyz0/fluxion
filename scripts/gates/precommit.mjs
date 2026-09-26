#!/usr/bin/env node
// The single definition of the pre-commit ladder. Used by .githooks/pre-commit (--staged),
// by `pnpm verify` / CI (--all), and by agents (--quick while iterating).
//   --staged     check what is staged (default when run from the hook)
//   --all        whole repo (CI)
//   --quick      fast subset for iteration
//   --summary    one line per step only
//   --no-review  skip check-reviewed (used when building the review packet)
// check-tests-kept and check-drift run from the commit-msg hook (they need the Removes-test /
// Threshold-change trailers); CI re-checks each pushed commit with --commit <sha>.
// Steps whose tooling does not exist yet print SKIP with the reason — never a silent pass.
import { exists, nodeAsync as node, runAsync } from './lib.mjs';
import { t } from './thresholds.mjs';

const argv = new Set(process.argv.slice(2));
const mode = argv.has('--all') ? 'all' : argv.has('--quick') ? 'quick' : 'staged';
const hasPkg = exists('package.json') && exists('turbo.json');
const pnpm = (...a) => runAsync('pnpm', a);

/** name, applies(mode), available() → true | skip-reason, exec() → {status, stdout, stderr} */
const STEPS = [
  ['skills-sync', () => true, () => true, () => node('scripts/harness/sync-skills.mjs', ['--check'])],
  ['portability', () => true, () => true, () => node('scripts/gates/check-portability.mjs')],
  [
    'index',
    () => true,
    () => (exists('AGENTS.md') && exists('docs/standards/README.md')) || 'index targets absent (partial checkout)',
    () => node('scripts/harness/build-index.mjs', ['--check']),
  ],
  [
    'size',
    () => true,
    () => exists('scripts/gates/check-size.mjs') || 'check-size.mjs not written yet (M0)',
    () => node('scripts/gates/check-size.mjs', [`--${mode}`]),
  ],
  // build before harness-tests and package hygiene: both need dist (turbo-cached, ~1 s when unchanged)
  ['build', (m) => m !== 'quick', () => hasPkg || 'no workspace yet (M1)', () => pnpm('run', 'build')],
  [
    'harness-tests',
    (m) => m !== 'quick',
    () => exists('tests/harness') || 'tests/harness not written yet (M0)',
    () => runAsync(process.execPath, ['--test', 'tests/harness/*.test.mjs']),
  ],
  // one typecheck path (M1 cp1 F4): the root solution `tsc -b` covers every workspace incl. apps;
  // incremental .tsbuildinfo keeps it fast. Per-package `typecheck` scripts exist for turbo filtering.
  ['typecheck', () => true, () => hasPkg || 'no workspace yet (M1)', () => pnpm('run', 'typecheck')],
  ['lint', () => true, () => (hasPkg && exists('biome.json')) || 'biome not configured yet (M1.9)', () => pnpm('run', 'lint')],
  [
    'test',
    () => true,
    () => hasPkg || 'no workspace yet (M1)',
    // one root Vitest run (node + browser projects); coverage floors are enforced on every full run.
    // quick mode runs only tests related to uncommitted changes, without coverage.
    () => (mode === 'quick' ? pnpm('exec', 'vitest', 'run', '--changed') : pnpm('run', 'test:coverage')),
  ],
  ['workflows', (m) => m !== 'quick', () => true, () => node('scripts/gates/check-workflows.mjs')],
  ['knip', (m) => m !== 'quick', () => (hasPkg && exists('knip.json')) || 'knip not configured', () => pnpm('exec', 'knip', '--no-progress')],
  ['publint', (m) => m !== 'quick', () => hasPkg || 'no workspace yet (M1)', () => node('scripts/gates/check-packages.mjs', ['--tool', 'publint'])],
  ['attw', (m) => m !== 'quick', () => hasPkg || 'no workspace yet (M1)', () => node('scripts/gates/check-packages.mjs', ['--tool', 'attw'])],
  ['size-limit', (m) => m !== 'quick', () => (hasPkg && exists('.size-limit.js')) || 'size-limit not configured', () => pnpm('exec', 'size-limit')],
  [
    'layering',
    (m) => m !== 'quick',
    // a missing .dependency-cruiser.mjs must fail in check-layering, not skip (M1.11 review F1)
    () => (exists('scripts/gates/check-layering.mjs') ? hasPkg || 'no workspace yet (M1)' : 'not written yet (M1)'),
    () => node('scripts/gates/check-layering.mjs'),
  ],
  [
    'licenses',
    (m) => m !== 'quick',
    () => (exists('scripts/gates/check-licenses.mjs') ? hasPkg || 'no workspace yet (M1)' : 'not written yet (M1)'),
    () => node('scripts/gates/check-licenses.mjs'),
  ],
  [
    'trace',
    (m) => m !== 'quick',
    () => (exists('scripts/gates/check-trace.mjs') ? exists('docs/requirements') || 'requirements absent (partial checkout)' : 'not written yet (M1)'),
    () => node('scripts/gates/check-trace.mjs'),
  ],
  [
    'api',
    (m) => m !== 'quick',
    () => (exists('scripts/gates/check-api.mjs') ? hasPkg || 'no workspace yet (M1)' : 'not written yet (M1)'),
    () => node('scripts/gates/check-api.mjs'),
  ],
  ['reviewed', (m) => m === 'staged' && !argv.has('--no-review'), () => true, () => node('scripts/gates/check-reviewed.mjs')],
];

const started = Date.now();
// Steps up to and including `build` run in order (later steps read dist/). Every step after it is
// independent, so they run concurrently; results still print in ladder order (M1.28, NFR-DX-002).
const BARRIER = 'build';

async function runStep([name, , available, exec]) {
  const avail = available();
  if (avail !== true) return { lines: [`SKIP ${name} — ${avail}`], ok: true };
  const t0 = Date.now();
  const r = await exec();
  const ms = Date.now() - t0;
  if (r.status === 0) return { lines: [`PASS ${name} (${ms}ms)`], ok: true };
  const detail = argv.has('--summary')
    ? []
    : `${r.stdout}\n${r.stderr}`
        .trim()
        .split(/\r?\n/)
        .slice(-40)
        .map((l) => `    ${l}`);
  return { lines: [`FAIL ${name} (${ms}ms)`, ...detail], ok: false };
}

const applicable = STEPS.filter(([, applies]) => applies(mode));
// without the barrier (quick mode has no build) nothing is known to be independent: run in order
const barrier = applicable.findIndex(([name]) => name === BARRIER);
const cut = barrier < 0 ? applicable.length : barrier + 1;
const results = [];
for (const step of applicable.slice(0, cut)) results.push(await runStep(step));
results.push(...(await Promise.all(applicable.slice(cut).map(runStep))));
const lines = results.flatMap((r) => r.lines);
let failed = results.some((r) => !r.ok);
const total = Date.now() - started;
const budget = mode === 'quick' ? t('QUICK_GATE_BUDGET_MS') : t('PRECOMMIT_BUDGET_MS');
if (mode !== 'all' && total > budget) {
  failed = true;
  lines.push(`FAIL budget — ${total}ms > ${budget}ms (NFR-DX-002)`);
}
for (const l of lines) console.log(l);
console.log(`VERIFY ${mode}: ${failed ? 'FAIL' : 'PASS'} (${(total / 1000).toFixed(1)}s)`);
process.exit(failed ? 1 : 0);
