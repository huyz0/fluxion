#!/usr/bin/env node
// Completion gate for M14 — AI toolkit & CLI v1 (docs/milestones/M14.md). Written first and red (M14.1). Each leg runs the real test, build or
// gate; a test file a later row writes is named here from the start, so the leg fails as `missing <file>` until that row lands. M14 started
// while M13 waits for a run with the three browser engines (roadmap Deferred), so this gate does not wait for M13.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentMilestone, exists, leg, node, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  changesetsCoverRange,
  checkBacklogDone,
  checkFinalReview,
  coverageGaps,
  loadMilestoneReviews,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);

/** A Vitest run of `files` (node project; `project` picks another) whose JSON report shows tests passed and none failed, skipped or todo. */
function vitestReport(files, project = 'node') {
  const missing = files.filter((f) => !exists(f));
  if (missing.length) return `missing ${missing.join(', ')}`;
  const dir = mkdtempSync(join(tmpdir(), 'm14-vt-'));
  try {
    const out = join(dir, 'report.json');
    const r = run('pnpm', ['exec', 'vitest', 'run', '--project', project, '--reporter=json', `--outputFile=${out}`, ...files]);
    if (!existsSync(out)) return `vitest wrote no report: ${ok(r)}`;
    const rep = JSON.parse(readFileSync(out, 'utf8'));
    if (rep.numFailedTestSuites > 0 || rep.testResults.some((f) => f.status === 'failed' && f.assertionResults.length === 0))
      return `a test file failed to run (${rep.numFailedTestSuites} failed suites)`;
    const tests = rep.testResults.flatMap((f) => f.assertionResults);
    const bad = tests.filter((a) => a.status !== 'passed');
    if (bad.length) return `${bad.length} test(s) not passed (${[...new Set(bad.map((a) => a.status))].join('/')}): ${bad[0].title}`;
    return tests.length > 0 ? { titles: tests.map((a) => a.fullName ?? a.title) } : `${files.join(', ')}: no tests ran`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** A Vitest file that exists and whose tests all pass: none skipped or todo, at least one run. */
const vitestFile = (file, project = 'node') => {
  const r = vitestReport([file], project);
  return typeof r === 'string' ? r : true;
};
const adr = (n, status = 'accepted') => {
  const dir = repoPath('docs/architecture/decisions');
  const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`));
  if (!file) return `missing ADR-${n}`;
  return new RegExp(`^status: ${status}\\b`, 'm').test(readFileSync(join(dir, file), 'utf8')) || `ADR-${n} is not ${status}`;
};

// ── requirements and decisions ─────────────────────────────────────────────────────────────────────
leg('check-trace --milestone M14 --priority M,S green: every requirement of the plan has a test naming it', () =>
  ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M14', '--priority', 'M,S'])),
);
leg('ADR-0035 (AI patch format v1), ADR-0036 (CLI contract) and ADR-0037 (fixed tokenizer) are accepted', () => {
  for (const n of ['0035', '0036', '0037']) {
    const r = adr(n);
    if (r !== true) return r;
  }
  return true;
});
leg('the CPU-normalised budget ADR is on file as proposed, never silently accepted (M14.22)', () => adr('0167', 'proposed'));

// ── the agent surface ──────────────────────────────────────────────────────────────────────────────
leg('the generated JSON Schemas match the committed specs/schema files (FR-AI-001)', () => vitestFile('packages/dsl/src/schema-drift.test.ts'));
leg('the FluxScript schema matches its committed copy and rejects bad files (M14.25, FR-AI-001)', () =>
  vitestFile('packages/dsl/src/read/json-schema.test.ts'),
);
leg('every FluxScript example validates against the FluxScript schema (M14.25, FR-AI-001)', () => {
  if (!exists('scripts/dsl/fluxscript-schema.test.ts')) return 'missing scripts/dsl/fluxscript-schema.test.ts';
  return ok(run('pnpm', ['--filter', '@fluxion/dsl', 'run', 'test:examples', '-t', 'FR-AI-001']));
});
leg('every registry item has a describe line and the catalog lists plugin items (FR-AI-002)', () => vitestFile('packages/dsl/src/catalog/catalog.test.ts'));
leg(`the core catalog and cheat sheet fit AI_CATALOG_MAX_TOKENS (${t('AI_CATALOG_MAX_TOKENS')}) (NFR-AI-002)`, () =>
  vitestFile('packages/dsl/src/catalog/token-budget.test.ts'),
);
// the corpus compiles against the first-party packs, which packages/dsl may not import: the test lives in the examples runner (scripts/dsl)
leg('DSL tokens against canonical JSON tokens reach AI_DSL_TOKEN_RATIO_MIN over examples/dsl (NFR-AI-003)', () => {
  if (!exists('scripts/dsl/token-ratio.test.ts')) return 'missing scripts/dsl/token-ratio.test.ts';
  return ok(run('pnpm', ['--filter', '@fluxion/dsl', 'run', 'test:examples', '-t', 'NFR-AI-003']));
});
leg('an invalid patch is rejected whole with pointer diagnostics; a valid one is one undo step (FR-AI-003)', () => {
  const fixtures = exists('packages/dsl/src/patch/__fixtures__') ? true : 'missing packages/dsl/src/patch/__fixtures__';
  return fixtures === true ? vitestFile('packages/dsl/src/patch/patch.test.ts') : fixtures;
});
leg('the diagnostic formatter ranks, dedupes and caps, and every error line carries a hint (FR-AI-004)', () =>
  vitestFile('packages/dsl/src/diagnostics-format.test.ts'),
);
leg('the lint rules each have a positive and a negative fixture and a score (FR-AI-005)', () => vitestFile('packages/dsl/src/lint/lint.test.ts'));
leg('the layout scorecard fails a change that makes the layered golden look worse (FR-LAY-004)', () => vitestFile('packages/layout/src/scorecard.test.ts'));

// ── the CLI ────────────────────────────────────────────────────────────────────────────────────────
leg('the exit-code matrix: ok 0, invalid 1, bad flag 2, crash 3 (FR-CLI-005)', () => vitestFile('packages/cli/src/e2e/exit-codes.test.ts'));
const CLI_COMMANDS = ['compile', 'validate', 'lint', 'layout', 'migrate', 'convert', 'patch', 'decompile', 'catalog', 'render'];
leg('every CLI command has a passing --json test and its output validates against specs/schema/cli-result.json (FR-CLI-002)', () => {
  const r = vitestReport(['packages/cli/src/e2e/commands.test.ts', 'packages/cli/src/e2e/convert.test.ts', 'packages/cli/src/e2e/render-png.test.ts']);
  if (typeof r === 'string') return r;
  const absent = CLI_COMMANDS.filter((c) => !r.titles.some((title) => title.includes(`fluxion ${c} --json`)));
  return absent.length === 0 || `no passing test titled "fluxion <command> --json" for: ${absent.join(', ')}`;
});
leg('convert round-trips flux, flux.html and flux.json by hash; decompile output recompiles equal (FR-EXP-008)', () =>
  vitestFile('packages/cli/src/e2e/convert.test.ts'),
);
leg('fluxion render --png writes one PNG per screen with the expected dimensions (FR-AI-006)', () => vitestFile('packages/cli/src/e2e/render-png.test.ts'));
leg('the studio exports a screen as PNG through SVG serialization (FR-AI-006)', () => vitestFile('apps/studio/src/png-export.browser.test.ts', 'browser'));
leg('the Mermaid exporter renders its golden .mmd for the fixture diagram (FR-EXP-007)', () => vitestFile('packages/format/src/mermaid.test.ts'));
leg('the Problems tab lists a lint finding (FR-EDT-021)', () => vitestFile('packages/editor/src/problems.lint.browser.test.tsx', 'browser'));
leg('apps/docs builds llms.txt and llms-full.txt, and a guide naming a missing catalog id fails the build (FR-AI-011)', () => {
  // the drift check that fails the build is its own test (written by M14.20)
  const drift = vitestFile('apps/docs/src/guide-drift.test.ts');
  if (drift !== true) return drift;
  const r = run('pnpm', ['--filter', '@fluxion/docs', 'run', 'build']);
  if (r.status !== 0) return `docs build failed: ${ok(r)}`;
  const missing = ['llms.txt', 'llms-full.txt'].filter((f) => !exists(`apps/docs/dist/${f}`));
  return missing.length === 0 || `apps/docs/dist lacks ${missing.join(', ')}`;
});

// ── coverage, changesets, quarantines ──────────────────────────────────────────────────────────────
function coverageLeg(pkg, floors) {
  const out = mkdtempSync(join(tmpdir(), 'm14-cov-'));
  try {
    const report = join(out, 'report.json');
    const r = run('pnpm', [
      'exec',
      'vitest',
      'run',
      '--coverage',
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory=${out}`,
      '--reporter=json',
      `--outputFile=${report}`,
      pkg,
    ]);
    if (!existsSync(report)) return `vitest wrote no report: ${ok(r)}`;
    const { numFailedTests, numPassedTests, numFailedTestSuites } = JSON.parse(readFileSync(report, 'utf8'));
    if (numFailedTests > 0 || numFailedTestSuites > 0 || numPassedTests === 0)
      return `${pkg}: ${numFailedTests} failed tests, ${numFailedTestSuites} failed suites, ${numPassedTests} passed`;
    const summary = join(out, 'coverage-summary.json');
    return existsSync(summary) ? coverageGaps(JSON.parse(readFileSync(summary, 'utf8')), pkg, floors, 300) : `no coverage summary: ${ok(r)}`;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
leg('packages/cli coverage at or above COVERAGE_RENDER_LINES/BRANCHES (no CLI floor is set; the nearer class)', () =>
  coverageLeg('packages/cli', { lines: t('COVERAGE_RENDER_LINES'), branches: t('COVERAGE_RENDER_BRANCHES') }),
);
leg('packages/dsl coverage at or above COVERAGE_PURE_LINES/BRANCHES', () =>
  coverageLeg('packages/dsl', { lines: t('COVERAGE_PURE_LINES'), branches: t('COVERAGE_PURE_BRANCHES') }),
);
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M14\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M14 commits yet';
});
leg('no open test quarantines', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.includes('tests/harness/'));
  return hits.length === 0 || `open quarantines: ${hits.slice(0, 3).join(' | ')}`;
});

// ── the tree, CI and the review ────────────────────────────────────────────────────────────────────
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
  'mode-policy',
];
leg('pnpm verify exits 0 with every planned step PASS', () => verifyLeg(VERIFY_STEPS));
leg('CI green on ubuntu, windows and macos at or after the M14 final review range', () => {
  if (!exists('.harness/reviews/milestone-M14-final.json')) return 'no M14 final review yet: its range end is what the evidence must cover';
  return ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M14']));
});
leg('every M14 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M14'), 'M14', loadMilestoneReviews('M14')));
leg('final milestone review covers M14', () => {
  const rev = json('.harness/reviews/milestone-M14-final.json');
  return rev ? checkFinalReview(rev, 'M14') : 'missing .harness/reviews/milestone-M14-final.json';
});
leg(
  'roadmap advanced past M14',
  () => (currentMilestone() !== null && !/^M(\d|1[0-4])$/.test(currentMilestone())) || `roadmap Current milestone is ${currentMilestone()}`,
);

await runLegs('m14');
