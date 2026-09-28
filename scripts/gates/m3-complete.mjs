#!/usr/bin/env node
// Completion gate for M3 — Core engine: store, commands, undo, registries (docs/milestones/M3.md).
// Written first and red (M3.1). Legs are behavioural: each runs the real tool, test or gate.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import { backlogTextFor, checkBacklogDone, checkFinalReview, loadMilestoneReviews, passingTestTitles, verifyLeg } from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const pnpm = (...a) => run('pnpm', a);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);

/**
 * Run the Vitest node project on `paths` filtered by `-t title`; at least `min` tests whose full
 * name contains the title must pass and none may fail. A comment or a skipped test cannot satisfy it.
 */
function vitestNamed(title, paths, { env = {}, min = 1 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'm3-gate-'));
  try {
    const out = join(dir, 'report.json');
    // -t takes a regular expression; the title is literal (M2 cp1 F1)
    const literal = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const r = run('pnpm', ['exec', 'vitest', 'run', '--project', 'node', '--reporter=json', `--outputFile=${out}`, '-t', literal, ...paths], {
      env: { ...process.env, ...env },
    });
    if (!existsSync(out)) return `vitest wrote no report: ${ok(r)}`;
    const tests = JSON.parse(readFileSync(out, 'utf8')).testResults.flatMap((f) => f.assertionResults);
    const named = tests.filter((x) => x.fullName.includes(title));
    const failed = named.filter((x) => x.status === 'failed');
    const passed = named.filter((x) => x.status === 'passed');
    if (r.status !== 0 || failed.length) return `"${title}": ${failed.length} failed (${ok(r)})`;
    return passed.length >= min || `"${title}": ${passed.length} passing test(s), need ${min}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run named node:test cases of one harness file; each pattern needs a passing case titled with it. */
function namedCases(file, patterns) {
  if (!exists(file)) return `missing ${file}`;
  for (const p of patterns) {
    const r = run(process.execPath, ['--test-reporter=spec', `--test-name-pattern=${p}`, file]);
    const titles = passingTestTitles(r.stdout).filter((x) => x.includes(p));
    if (r.status !== 0 || titles.length < 1) return `${file}: no passing test titled with "${p}"`;
  }
  return true;
}

/** Every [row, title, package] passes under its exact title. */
function titled(list) {
  const bad = list.map(([row, title, pkg, env]) => [row, vitestNamed(title, [`packages/${pkg}`], { env })]).filter(([, r]) => r !== true);
  return bad.length === 0 || bad.map(([row, r]) => `${row} ${r}`).join('; ');
}

leg('check-trace --milestone M3 green', () => ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M3'])));

// a stub package cannot pass the coverage leg: core must have real code to cover
const MIN_STATEMENTS = 400;
leg('core coverage at or above the pure-package floors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm3-cov-'));
  try {
    const r = pnpm(
      'exec',
      'vitest',
      'run',
      '--project',
      'node',
      '--coverage',
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory=${dir}`,
      '--reporter=json',
      `--outputFile=${join(dir, 'report.json')}`,
      'packages/core',
    );
    // the exit status also reflects other packages' per-glob floors (M2.1 review F1): judge the
    // tests from the report and the floors from the summary
    const report = join(dir, 'report.json');
    if (!existsSync(report)) return `vitest wrote no report: ${ok(r)}`;
    const { numFailedTests, numPassedTests } = JSON.parse(readFileSync(report, 'utf8'));
    if (numFailedTests > 0 || numPassedTests === 0) return `${numFailedTests} failed, ${numPassedTests} passed`;
    const summaryPath = join(dir, 'coverage-summary.json');
    if (!existsSync(summaryPath)) return `no coverage summary: ${ok(r)}`;
    const files = Object.entries(JSON.parse(readFileSync(summaryPath, 'utf8'))).filter(([f]) => f.replace(/\\/g, '/').includes('/packages/core/src/'));
    const sum = (k, f) => files.reduce((a, [, v]) => a + v[k][f], 0);
    const pct = (k) => (sum(k, 'total') === 0 ? 0 : (100 * sum(k, 'covered')) / sum(k, 'total'));
    const bad = [];
    if (sum('statements', 'total') < MIN_STATEMENTS) bad.push(`${sum('statements', 'total')} statements (< ${MIN_STATEMENTS})`);
    if (pct('lines') < t('COVERAGE_PURE_LINES')) bad.push(`lines ${pct('lines').toFixed(1)}%`);
    if (pct('branches') < t('COVERAGE_PURE_BRANCHES')) bad.push(`branches ${pct('branches').toFixed(1)}%`);
    return bad.length === 0 || `core: ${bad.join('; ')}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// the plan's property tests, by the titles their rows quote
const UNDO_PROPERTIES = ['NFR-REL-003: any sequence then full undo restores initial', 'NFR-REL-003: redo all restores the final document'];
const UNDO_PROPERTY_FILE = 'packages/core/src/undo-property.test.ts';
leg('NFR-REL-003 undo properties pass (default runs and FC_RUNS=1000)', () => {
  // FC_RUNS must reach the properties: the file counts its runs against the global numRuns and sets
  // no local numRuns, or a 1000-run rerun would be a 200-run no-op (M2.25 review F1; M3.1 review F2)
  if (!exists(UNDO_PROPERTY_FILE)) return `missing ${UNDO_PROPERTY_FILE}`;
  const src = readText(UNDO_PROPERTY_FILE);
  // a local override may be `numRuns: n`, `numRuns : n` or the shorthand `{ numRuns }` (M3.1 review r2 F1)
  if (!UNDO_PROPERTIES.every((x) => src.includes(x)) || !/readConfigureGlobal\(\)\.numRuns/.test(src) || /\bnumRuns\b\s*[:,}]/.test(src))
    return `${UNDO_PROPERTY_FILE} must hold both NFR-REL-003 titles, assert its run counts against fc.readConfigureGlobal().numRuns and set no local numRuns`;
  return titled(
    UNDO_PROPERTIES.flatMap((x) => [
      ['M3.21', x, 'core'],
      ['M3.21', x, 'core', { FC_RUNS: '1000' }],
    ]),
  );
});
leg('NFR-MNT-006 store properties pass', () =>
  titled([
    ['M3.10', "NFR-MNT-006: WHEN one record changes THE SYSTEM SHALL notify only that record's subscribers", 'core'],
    ['M3.11', 'NFR-MNT-006: every transaction emits record puts/deletes only', 'core'],
    ['M3.11', 'NFR-MNT-006: IF a put is invalid THEN the transaction SHALL roll back with diagnostics', 'core'],
    ['M3.12', 'NFR-MNT-006: incrementally maintained indexes equal indexes rebuilt from scratch', 'core'],
    ['M3.22', 'NFR-MNT-006: writes to a fork never reach the parent', 'core'],
    ['M3.22', 'NFR-MNT-006: a read-only store rejects element.update with a diagnostic', 'core'],
    ['M3.22', 'NFR-MNT-006: fork.diffFrom applied to the parent keeps concurrent parent edits', 'core'],
  ]),
);
// a harness test: a Vitest raw-import of every source would make coverage skip untested files (M3.17)
leg('NFR-MNT-006: no production code calls store.transact outside a command run (named case)', () =>
  namedCases('tests/harness/architecture.test.mjs', [
    'NFR-MNT-006: no production code calls store.transact outside a command run',
    'a direct write in an app fails',
  ]),
);
leg('acceptance of M3.9-M3.20 passes under the planned titles', () =>
  titled([
    ['M3.9', 'NFR-REL-005: seeded Random yields the same sequence across runs', 'core'],
    ['M3.13', 'FR-EXT-001: WHEN a registration is disposed THE SYSTEM SHALL remove it and bump changes$', 'core'],
    ['M3.13', 'FR-EXT-001: a duplicate key from another source is a diagnostic', 'core'],
    ['M3.14', 'FR-EXT-001: after any hook-run transaction validate reports 0 referential errors', 'core'],
    ['M3.16', 'FR-EDT-006: IF args fail the schema THEN THE SYSTEM SHALL return diagnostics and leave the store unchanged', 'core'],
    ['M3.17', 'FR-DOC-010: screen.reorder writes exactly one record', 'core'],
    ['M3.19', 'FR-EDT-006: WHEN undo then redo runs THE SYSTEM SHALL reproduce the post-state exactly', 'core'],
    ['M3.19', 'FR-EDT-006: undo restores the metaBefore an element.update command recorded', 'core'],
    // through the command path, the only production write path (cp1 F2)
    ['M3.20', 'FR-EDT-006: WHEN 60 merged element.update commands share a key THE SYSTEM SHALL create 1 history entry', 'core'],
    ['M3.20', 'FR-EDT-006: an empty-diff transaction does not break a merge', 'core'],
    ['M3.26', 'FR-EXT-001: an idempotent hook that re-writes an equal value settles', 'core'],
    ['M3.26', 'FR-EXT-001: element.update with an identity field in fields returns a diagnostic', 'core'],
  ]),
);

// NFR-PERF-006: vitest bench JSON; an undo and a redo benchmark for every built-in record command
// (M3.17), each p99 within UNDO_MAX_MS (M3.1 review F1)
const BUILT_IN_COMMANDS = [
  'element.create',
  'element.update',
  'element.delete',
  'screen.create',
  'screen.delete',
  'screen.reorder',
  'binding.set',
  'document.update',
];
// undo/redo and the forward transactions, both on stores with default options: validation on, as in
// dev and test (cp1 F3); a bench that switches validation off cannot pass this leg
const BENCHES = ['packages/core/bench/undo-5000.bench.ts', 'packages/core/bench/transact-5000.bench.ts'];
leg(`undo-5000 and transact-5000 benches: p99 <= UNDO_MAX_MS (${t('UNDO_MAX_MS')} ms) with validation on`, () => {
  const missingFiles = BENCHES.filter((b) => !exists(b));
  if (missingFiles.length) return `missing ${missingFiles.join(', ')}`;
  const off = BENCHES.filter((b) => /\bvalidate\s*:\s*false\b/.test(readText(b)));
  if (off.length) return `validation switched off in ${off.join(', ')}`;
  const dir = mkdtempSync(join(tmpdir(), 'm3-bench-'));
  try {
    const out = join(dir, 'bench.json');
    const r = pnpm('exec', 'vitest', 'bench', '--run', '--project', 'node', `--outputJson=${out}`, ...BENCHES);
    if (!existsSync(out)) return `no bench output: ${ok(r)}`;
    const benches = JSON.parse(readFileSync(out, 'utf8')).files.flatMap((f) => f.groups.flatMap((g) => g.benchmarks));
    // names are exactly "<undo|redo|transact> <command id>", one per built-in command (M3.1 review F1)
    const want = BUILT_IN_COMMANDS.flatMap((c) => [`undo ${c}`, `redo ${c}`, `transact ${c}`]);
    const missing = want.filter((w) => !benches.some((b) => b.name === w));
    if (missing.length) return `no benchmark named: ${missing.join(', ')}`;
    const slow = benches.filter((b) => want.includes(b.name) && !(b.p99 <= t('UNDO_MAX_MS')));
    return slow.length === 0 || slow.map((b) => `${b.name} p99 ${Number(b.p99).toFixed(2)} ms`).join('; ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

leg('check-kind-switch: negative fixture fails and the repo passes', () => {
  if (!exists('scripts/gates/check-kind-switch.mjs')) return 'missing scripts/gates/check-kind-switch.mjs';
  const r = node('scripts/gates/check-kind-switch.mjs');
  if (r.status !== 0) return ok(r);
  // cp1 F6: the scope covers every package, pack and app that consumes kinds
  return namedCases('tests/harness/kind-switch.test.mjs', ['switch on el.kind in render fails', 'if-chain on connector kinds in routing fails']);
});
leg('check-layering green (core stays pure)', () => {
  if (!exists('packages/core/src/ports')) return 'missing packages/core/src/ports';
  return ok(node('scripts/gates/check-layering.mjs'));
});
leg('core API report lists the M3 surface and check-api passes', () => {
  const report = 'packages/core/api/core.api.md';
  if (!exists(report)) return `missing ${report}`;
  // a report of the M1 skeleton (VERSION only) is not the M3 surface
  const n = (readText(report).match(/^export /gm) ?? []).length;
  if (n < 10) return `core.api.md lists ${n} exports (< 10)`;
  return ok(node('scripts/gates/check-api.mjs'));
});
leg('03-core-engine names only core exports that exist (named case)', () => namedCases('tests/harness/docs-consistency.test.mjs', ['03 names core exports']));

// M2 final and delta hand-offs (M3.md "Handed off from M2")
leg('one Result/err convention across schema and geometry (M2 final F3)', () =>
  titled([['M3.3', 'NFR-MNT-007: geometry Result is assignable to the schema Result', 'core']]),
);
leg('shared verify leg fails a stale budget record under CI=true (named case)', () =>
  namedCases('tests/harness/verify-leg.test.mjs', ['stale budget record fails the shared verify leg under CI=true']),
);
leg('budget refresh after a lockfile change is agent-runnable (named cases)', () =>
  namedCases('tests/harness/budget.test.mjs', ['staged lockfile runs the budget step', 'cold setup recorded from a CI run']),
);
leg('docs-consistency checks the catalogue both ways (named cases)', () =>
  namedCases('tests/harness/docs-consistency.test.mjs', [
    'schema field missing from the catalogue fails',
    'element-row field outside the core-kind intersection fails',
  ]),
);
leg('check-ci-evidence reports stale evidence with transport failures (named case)', () =>
  namedCases('tests/harness/ci-evidence.test.mjs', ['stale sha reported with a transport failure']),
);
leg('valid fixtures behave as named (unknown-kind warns)', () =>
  titled([['M3.8', 'FR-DOC-005: the unknown-kind fixture parses with FLX_KIND_UNKNOWN', 'schema']]),
);

// every planned verify step must PASS, through the shared leg (CI unset, Docker-only SKIP; M3.4)
const VERIFY_STEPS = [
  'build',
  'harness-tests',
  'typecheck',
  'lint',
  'test',
  'knip',
  'publint',
  'attw',
  'size-limit',
  'layering',
  'licenses',
  'trace',
  'api',
  'budget',
  'kind-switch',
];
leg('pnpm verify exits 0 with every planned step PASS', () => verifyLeg(VERIFY_STEPS));
leg('no open test quarantines', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.includes('tests/harness/'));
  return hits.length === 0 || `open quarantines: ${hits.slice(0, 3).join(' | ')}`;
});

leg('CI green on ubuntu, windows and macos at or after the M3 final review range', () =>
  ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M3'])),
);
leg('every M3 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M3'), 'M3', loadMilestoneReviews('M3')));
leg('final milestone review covers M3', () => {
  const rev = json('.harness/reviews/milestone-M3-final.json');
  return rev ? checkFinalReview(rev, 'M3') : 'missing .harness/reviews/milestone-M3-final.json';
});
leg('roadmap advanced past M3', () => !['M0', 'M1', 'M2', 'M3'].includes(currentMilestone()) || `roadmap Current milestone is ${currentMilestone()}`);

await runLegs('m3');
