#!/usr/bin/env node
// The single definition of the pre-commit ladder. Used by .githooks/pre-commit (--staged),
// by `pnpm verify` / CI (--all), and by agents (--quick while iterating).
//   --staged     check what is staged (default when run from the hook); the harness tests and the
//                Vitest run are scoped to what the staged paths can affect (ladder-scope.mjs, M4.26)
//   --staged-paths a,b,c   with --staged: scope as if these paths were staged (check-budget --record)
//   --all        whole repo (CI)
//   --quick      fast subset for iteration
//   --summary    one line per step only
//   --no-review  skip check-reviewed (used when building the review packet)
//   --no-budget  skip the budget step (check-budget --record times the ladder it is writing a record for)
// check-tests-kept and check-drift run from the commit-msg hook (they need the Removes-test /
// Threshold-change trailers); CI re-checks each pushed commit with --commit <sha>.
// Steps whose tooling does not exist yet print SKIP with the reason — never a silent pass.
import { readdirSync, readFileSync } from 'node:fs';
import { harnessFiles, lockfileWorkspaceOnly, packagingDirs, packagingNeeded, apiScope as stagedApiScope, testScope } from './ladder-scope.mjs';
import { exists, git, listFiles, nestedSkip, nodeAsync as node, repoPath, runAsync } from './lib.mjs';
import { t } from './thresholds.mjs';

const argv = new Set(process.argv.slice(2));
const mode = argv.has('--all') ? 'all' : argv.has('--quick') ? 'quick' : 'staged';
const hasPkg = exists('package.json') && exists('turbo.json');
const pnpm = (...a) => runAsync('pnpm', a);
// --staged-paths a,b,c: scope the staged ladder as if these were staged (check-budget --record times the worst-case commit)
const pretended = process.argv.includes('--staged-paths')
  ? (process.argv[process.argv.indexOf('--staged-paths') + 1] ?? '').split(',').filter(Boolean)
  : undefined;
const stagedPaths = () => pretended ?? git(['diff', '--cached', '--name-only']).stdout.split(/\r?\n/).filter(Boolean);
const lockfileStaged = () => stagedPaths().includes('pnpm-lock.yaml');

// staged mode runs what the staged paths can affect (M4 cp1 F2; ladder-scope.mjs); --all runs everything
const HARNESS = () =>
  readdirSync(repoPath('tests/harness'))
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => `tests/harness/${f}`);
// a staged lockfile whose external packages match HEAD's changes only workspace links (M4.29)
const workspaceLock = () => lockfileStaged() && lockfileWorkspaceOnly(git(['show', 'HEAD:pnpm-lock.yaml']).stdout, git(['show', ':pnpm-lock.yaml']).stdout);
const scopeOptions = () => ({ lockfileWorkspaceOnly: workspaceLock() });
const harnessToRun = () => (mode === 'staged' ? harnessFiles(stagedPaths(), HARNESS(), scopeOptions()) : HARNESS());
const workspaces = () => (exists('tools/gen/workspaces.json') ? JSON.parse(readFileSync(repoPath('tools/gen/workspaces.json'), 'utf8')).workspaces : []);
const browserTested = () =>
  workspaces()
    .map((w) => w.dir)
    .filter((dir) => listFiles(`${dir}/src`).some((p) => /\.browser\.test\.[cm]?[jt]sx?$/.test(p)));
// the publishable libraries (what publint and attw pack) named by a workspace list: the same in HEAD's and the staged list
const libraries = (text) => {
  try {
    return JSON.stringify(
      JSON.parse(text)
        .workspaces.filter((w) => !w.private && (w.dir.startsWith('packages/') || w.dir.startsWith('packs/')))
        .map((w) => [w.dir, w.name, w.layer, w.runtime]),
    );
  } catch {
    return undefined;
  }
};
const librariesUnchanged = () => {
  if (!stagedPaths().includes('tools/gen/workspaces.json')) return false;
  const [before, after] = [libraries(git(['show', 'HEAD:tools/gen/workspaces.json']).stdout), libraries(git(['show', ':tools/gen/workspaces.json']).stdout)];
  // a list that cannot be read (either side) is a change: both unreadable must not look the same
  return before !== undefined && after !== undefined && before === after;
};
const packagingOptions = () => ({ lockfileWorkspaceOnly: workspaceLock(), librariesUnchanged: librariesUnchanged() });
const packagingOrSkip = () =>
  mode !== 'staged' || packagingNeeded(stagedPaths(), packagingOptions()) || 'no staged manifest, export or build setting (CI runs it)';
// a staged commit that changes the packing of some libraries only packs those (CI's --all packs them all)
const packagingArgs = () => {
  const dirs = mode === 'staged' ? packagingDirs(stagedPaths(), packagingOptions()) : undefined;
  return dirs === undefined ? [] : ['--dirs', dirs.join(',')];
};
// a staged commit checks the API reports of the libraries it touches, and TypeDoc when a library source changed (CI's --all checks everything)
const apiScope = () => (mode === 'staged' ? stagedApiScope(stagedPaths()) : undefined);
const apiOrSkip = () => {
  const scope = apiScope();
  return scope === undefined || scope.dirs.length > 0 || scope.typedoc || 'no staged library (CI checks every API report)';
};
async function api() {
  const scope = apiScope();
  if (scope === undefined) return node('scripts/gates/check-api.mjs');
  let result;
  for (const [i, dir] of scope.dirs.entries()) {
    const withTypedoc = scope.typedoc && i === scope.dirs.length - 1;
    result = await node('scripts/gates/check-api.mjs', ['--package', dir, ...(withTypedoc ? ['--typedoc'] : [])]);
    if (result.status !== 0) return result;
  }
  return result;
}
const testPlan = () => (mode === 'staged' ? testScope(stagedPaths(), workspaces(), browserTested(), scopeOptions()) : { run: true, browser: true });

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
  // one typecheck path (M1 cp1 F4): the root solution `tsc -b` covers every workspace incl. apps;
  // incremental .tsbuildinfo keeps it fast. Per-package `typecheck` scripts exist for turbo filtering.
  // Before the build barrier: TypeDoc (docs build, api) reads the .tsbuild declarations of project
  // references, which a fresh checkout has only after tsc -b (M3.5, first cross-workspace import)
  ['typecheck', () => true, () => hasPkg || 'no workspace yet (M1)', () => pnpm('run', 'typecheck')],
  // build before harness-tests and package hygiene: both need dist (turbo-cached, ~1 s when unchanged)
  // --all (verify, CI) builds everything; a staged commit builds libraries only: later steps read their
  // dist/ (publint, attw, api, size-limit), and the docs site and studio bundle are too slow for the
  // pre-commit budget (M1.18)
  [
    'build',
    (m) => m !== 'quick',
    () => hasPkg || 'no workspace yet (M1)',
    () => (mode === 'all' ? pnpm('run', 'build') : pnpm('turbo', 'run', 'build', '--filter=./packages/*', '--filter=./packs/*')),
  ],
  [
    'harness-tests',
    (m) => m !== 'quick',
    () => (!exists('tests/harness') ? 'tests/harness not written yet (M0)' : harnessToRun().length > 0 || 'no staged path the harness tests read'),
    // spec reporter: it closes with a "failing tests" list, which the FAIL detail starts at (M1.39)
    () => runAsync(process.execPath, ['--test-reporter=spec', '--test', ...harnessToRun()]),
  ],
  ['lint', () => true, () => (hasPkg && exists('biome.json')) || 'biome not configured yet (M1.9)', () => pnpm('run', 'lint')],
  [
    'test',
    () => true,
    () => (!hasPkg ? 'no workspace yet (M1)' : mode === 'quick' || testPlan().run || 'no staged path the Vitest run reads'),
    // one root Vitest run (node + browser projects); coverage floors are enforced on every full run.
    // quick mode runs only tests related to uncommitted changes, without coverage. A staged commit that
    // touches no browser-tested workspace nor its dependencies runs the node project only, its
    // coverage limited to the workspaces without browser tests (ladder-scope.mjs).
    () => {
      if (mode === 'quick') return pnpm('exec', 'vitest', 'run', '--changed');
      const plan = testPlan();
      if (plan.browser) return pnpm('run', 'test:coverage');
      return pnpm('exec', 'vitest', 'run', '--coverage', '--project', 'node', ...plan.include.map((g) => `--coverage.include=${g}`));
    },
  ],
  ['workflows', (m) => m !== 'quick', () => true, () => node('scripts/gates/check-workflows.mjs')],
  ['knip', (m) => m !== 'quick', () => (hasPkg && exists('knip.json')) || 'knip not configured', () => pnpm('exec', 'knip', '--no-progress')],
  // a staged commit of sources, reports, specs and docs changes no manifest, export or build setting: CI's --all runs both
  [
    'publint',
    (m) => m !== 'quick',
    () => (hasPkg ? packagingOrSkip() : 'no workspace yet (M1)'),
    () => node('scripts/gates/check-packages.mjs', ['--tool', 'publint', ...packagingArgs()]),
  ],
  [
    'attw',
    (m) => m !== 'quick',
    () => (hasPkg ? packagingOrSkip() : 'no workspace yet (M1)'),
    () => node('scripts/gates/check-packages.mjs', ['--tool', 'attw', ...packagingArgs()]),
  ],
  ['size-limit', (m) => m !== 'quick', () => (hasPkg && exists('.size-limit.js')) || 'size-limit not configured', () => pnpm('exec', 'size-limit')],
  [
    'layering',
    (m) => m !== 'quick',
    // a missing .dependency-cruiser.mjs must fail in check-layering, not skip (M1.11 review F1)
    () => (exists('scripts/gates/check-layering.mjs') ? hasPkg || 'no workspace yet (M1)' : 'not written yet (M1)'),
    () => node('scripts/gates/check-layering.mjs'),
  ],
  // no switch or if-chain on an extensible kind outside registries (FR-EXT-001, M3.15)
  ['kind-switch', () => true, () => exists('scripts/gates/check-kind-switch.mjs') || 'not written yet (M3)', () => node('scripts/gates/check-kind-switch.mjs')],
  // only render/src/mode-policy.ts branches on the render mode (04 §2.6, ADR-0015; M4.11)
  ['mode-policy', () => true, () => exists('scripts/gates/check-mode-policy.mjs') || 'not written yet (M4)', () => node('scripts/gates/check-mode-policy.mjs')],
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
    () => (exists('scripts/gates/check-api.mjs') ? (hasPkg ? apiOrSkip() : 'no workspace yet (M1)') : 'not written yet (M1)'),
    () => api(),
  ],
  // recorded cold-setup / quick / staged timings within the thresholds (NFR-DX-001, NFR-DX-002); a
  // commit that stages pnpm-lock.yaml must carry a record for it (ADR-0145)
  [
    'budget',
    (m) => !argv.has('--no-budget') && (m === 'all' || (m === 'staged' && lockfileStaged())),
    () => (exists('scripts/gates/check-budget.mjs') ? hasPkg || 'no workspace yet (M1)' : 'not written yet (M1)'),
    () => node('scripts/gates/check-budget.mjs', mode === 'staged' ? ['--staged'] : []),
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
  // a tool that exits 0 but reports "<tool>: SKIP — <why>" did not run its check (M1 cp1 F3)
  const nested = r.status === 0 ? nestedSkip(r.stdout) : null;
  if (nested) return { lines: [`SKIP ${name} — ${nested}`], ok: true };
  if (r.status === 0) return { lines: [`PASS ${name} (${ms}ms)`], ok: true };
  const all = `${r.stdout}\n${r.stderr}`.trim().split(/\r?\n/);
  // a node:test spec report ends with a "failing tests" list, but one long assertion message pushes
  // the test names out of a plain tail: start at that list when there is one (M1.39)
  const failing = all.findIndex((l) => l.startsWith('✖ failing tests:'));
  const tail = failing >= 0 ? all.slice(failing, failing + 40) : all.slice(-40);
  // a failed fast-check property names its seed and counterexample near the top of the report, above
  // the tail: keep those lines, so an intermittent property failure can be replayed (M4.31)
  const replay = all.filter((l) => /Property failed after|Counterexample:|\{ seed: -?\d+/.test(l) && !tail.includes(l)).slice(0, 6);
  const shown = [...replay, ...tail];
  const detail = argv.has('--summary') ? [] : shown.map((l) => `    ${l}`);
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
