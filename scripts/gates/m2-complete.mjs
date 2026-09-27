#!/usr/bin/env node
// Completion gate for M2 — Schema & geometry foundations (docs/milestones/M2.md).
// Written first and red (M2.1). Legs are behavioural: each runs the real tool, test or gate.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import { backlogTextFor, checkBacklogDone, checkFinalReview, checkVerifyOutput, loadMilestoneReviews, passingTestTitles } from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const pnpm = (...a) => run('pnpm', a);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);

/**
 * Run the Vitest node project on `paths` filtered by `-t pattern`; at least `min` tests whose full
 * name contains the pattern must pass and none may fail. A comment or a skipped test cannot satisfy it.
 */
function vitestNamed(pattern, paths, { env = {}, min = 1 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'm2-gate-'));
  try {
    const out = join(dir, 'report.json');
    const r = run('pnpm', ['exec', 'vitest', 'run', '--project', 'node', '--reporter=json', `--outputFile=${out}`, '-t', pattern, ...paths], {
      env: { ...process.env, ...env },
    });
    if (!existsSync(out)) return `vitest wrote no report: ${ok(r)}`;
    const tests = JSON.parse(readFileSync(out, 'utf8')).testResults.flatMap((f) => f.assertionResults);
    const named = tests.filter((x) => x.fullName.includes(pattern));
    const failed = named.filter((x) => x.status === 'failed');
    const passed = named.filter((x) => x.status === 'passed');
    if (r.status !== 0 || failed.length) return `"${pattern}": ${failed.length} failed (${ok(r)})`;
    return passed.length >= min || `"${pattern}": ${passed.length} passing test(s), need ${min}`;
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

const PURE = ['schema', 'geometry'];
// a stub package cannot pass the coverage leg: each must have real code to cover
const MIN_STATEMENTS = 300;

leg('check-trace --milestone M2 green', () => ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M2'])));

/** Floor problems of one package in a coverage json-summary (lines, branches, minimum size). */
function floorProblems(summary, pkg) {
  const files = Object.entries(summary).filter(([f]) => f.replace(/\\/g, '/').includes(`/packages/${pkg}/src/`));
  const sum = (k, f) => files.reduce((a, [, v]) => a + v[k][f], 0);
  const pct = (k) => (sum(k, 'total') === 0 ? 0 : (100 * sum(k, 'covered')) / sum(k, 'total'));
  const bad = [];
  if (sum('statements', 'total') < MIN_STATEMENTS) bad.push(`${pkg}: ${sum('statements', 'total')} statements (< ${MIN_STATEMENTS})`);
  if (pct('lines') < t('COVERAGE_PURE_LINES')) bad.push(`${pkg}: lines ${pct('lines').toFixed(1)}%`);
  if (pct('branches') < t('COVERAGE_PURE_BRANCHES')) bad.push(`${pkg}: branches ${pct('branches').toFixed(1)}%`);
  return bad;
}

leg('schema and geometry coverage at or above the pure-package floors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm2-cov-'));
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
      ...PURE.map((p) => `packages/${p}`),
    );
    // the exit status also reflects the other packages' per-glob floors, which this run does not
    // exercise (M2.1 review F1): judge the tests from the report and the floors from the summary
    const report = join(dir, 'report.json');
    if (!existsSync(report)) return `vitest wrote no report: ${ok(r)}`;
    const { numFailedTests, numPassedTests } = JSON.parse(readFileSync(report, 'utf8'));
    if (numFailedTests > 0 || numPassedTests === 0) return `${numFailedTests} failed, ${numPassedTests} passed`;
    const summaryPath = join(dir, 'coverage-summary.json');
    if (!existsSync(summaryPath)) return `no coverage summary: ${ok(r)}`;
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const bad = PURE.flatMap((p) => floorProblems(summary, p));
    return bad.length === 0 || bad.join('; ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

leg('NFR-REL-002 fuzz: parse never throws on corrupted input at 10 000 runs', () =>
  vitestNamed('NFR-REL-002', ['packages/schema'], { env: { FC_RUNS: '10000' } }),
);

leg('fixtures: gen.mjs --check exits 0 and every fixtures/docs file behaves as named', () => {
  if (!exists('scripts/fixtures/gen.mjs')) return 'missing scripts/fixtures/gen.mjs';
  const r = node('scripts/fixtures/gen.mjs', ['--check']);
  if (r.status !== 0) return ok(r);
  return vitestNamed('fixtures/docs behave as named', ['packages/schema']);
});

leg('v1.0 fixture migrates and validates', () => {
  if (!exists('packages/schema/__fixtures__/v1.0')) return 'missing packages/schema/__fixtures__/v1.0';
  return vitestNamed('FR-DOC-003', ['packages/schema'], { min: 2 });
});

leg('NFR-REL-005 determinism suite passes', () => vitestNamed('NFR-REL-005', ['packages/schema', 'packages/geometry']));

leg('API reports for schema and geometry exist and check-api passes', () => {
  const missing = PURE.map((p) => `packages/${p}/api/${p}.api.md`).filter((f) => !exists(f));
  if (missing.length) return `missing ${missing.join(', ')}`;
  // a report of the M1 skeleton (VERSION only) is not the M2 surface
  const thin = PURE.filter((p) => (readText(`packages/${p}/api/${p}.api.md`).match(/^export /gm) ?? []).length < 5);
  if (thin.length) return `API report lists fewer than 5 exports: ${thin.join(', ')}`;
  return ok(node('scripts/gates/check-api.mjs'));
});

leg('diagnostic codes documented in docs/reference/diagnostics.md', () => {
  if (!exists('docs/reference/diagnostics.md')) return 'missing docs/reference/diagnostics.md';
  if (!exists('packages/schema/src/diagnostics.ts')) return 'missing packages/schema/src/diagnostics.ts';
  const codes = [...new Set(readText('packages/schema/src/diagnostics.ts').match(/\bFLX_[A-Z_]+\b/g) ?? [])];
  if (codes.length < 5) return `only ${codes.length} FLX_* codes in diagnostics.ts`;
  const doc = readText('docs/reference/diagnostics.md');
  const undocumented = codes.filter((c) => !doc.includes(c));
  return undocumented.length === 0 || `undocumented: ${undocumented.join(', ')}`;
});

// M1 final hand-offs (M1.md "Handed off from M1")
// the three-OS CI runs (and the ubuntu workflow lint in them) are re-read from GitHub; the recorded
// sha must be at or after the final review range end (M2.20, M1 final F3; M2.1 review F2)
leg('CI green on ubuntu, windows and macos at or after the M2 final review range', () =>
  ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M2'])),
);
leg('ci-evidence must cover the reviewed range (named case)', () => namedCases('tests/harness/ci-evidence.test.mjs', ['before the final review range end']));
leg('cold-setup CI job exists and check-budget --record isolation is tested', () => {
  const ci = exists('.github/workflows/ci.yml') ? readText('.github/workflows/ci.yml') : '';
  if (!/^ {2}cold-setup:\s*$/m.test(ci)) return 'ci.yml has no cold-setup job';
  return namedCases('tests/harness/budget.test.mjs', ['record isolation']);
});
leg('one three-OS verify matrix; commit-message check is a script', () => {
  const threeOs = ['gates.yml', 'ci.yml'].filter((w) => {
    const wf = exists(`.github/workflows/${w}`) ? readText(`.github/workflows/${w}`) : '';
    return /precommit\.mjs --all|pnpm verify\b/.test(wf) && /windows-latest/.test(wf) && /macos-latest/.test(wf);
  });
  if (threeOs.length !== 1) return `three-OS verify runs in ${threeOs.length} workflows (${threeOs.join(', ')})`;
  // the per-commit message step is one script call, not inline shell (M1 final F5)
  const gates = exists('.github/workflows/gates.yml') ? readText('.github/workflows/gates.yml') : '';
  const step = /- name: per-commit message gates[\s\S]*?(?=\n {6}- |(?![\s\S]))/.exec(gates)?.[0] ?? '';
  if (!step) return 'gates.yml has no per-commit message gates step';
  if (/run: \|/.test(step) || !/run: node scripts\/gates\/check-commits\.mjs\b/.test(step))
    return 'per-commit message step is not a single check-commits.mjs call';
  return namedCases('tests/harness/ci-workflow.test.mjs', ['commit messages checked by script']);
});

// every planned verify step must PASS; `workflows` needs Docker plus the linter images, which CI
// runs with --require-docker (gates.yml, ubuntu) — locally it may SKIP only for a missing engine
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
];
leg('pnpm verify exits 0 with every planned step PASS', () => {
  const r = pnpm('verify');
  if (r.status !== 0) return ok(r);
  const skips = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('SKIP') && !/^SKIP workflows — Docker not available$/.test(l.trim()));
  if (skips.length) return `skipped: ${skips.join(' | ')}`;
  return checkVerifyOutput(r.stdout, VERIFY_STEPS);
});
leg('no open test quarantines', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.includes('tests/harness/'));
  return hits.length === 0 || `open quarantines: ${hits.slice(0, 3).join(' | ')}`;
});

leg('every M2 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M2'), 'M2', loadMilestoneReviews('M2')));
leg('final milestone review covers M2', () => {
  const rev = json('.harness/reviews/milestone-M2-final.json');
  return rev ? checkFinalReview(rev, 'M2') : 'missing .harness/reviews/milestone-M2-final.json';
});
leg('roadmap advanced past M2', () => !['M0', 'M1', 'M2'].includes(currentMilestone()) || `roadmap Current milestone is ${currentMilestone()}`);

await runLegs('m2');
