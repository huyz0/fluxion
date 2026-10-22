#!/usr/bin/env node
// Completion gate for M17 — layout suite v2 and smart templates, part of R3 (docs/milestones/M17.md). Written first and red (M17.1). Each leg runs the real test, bench,
// spec or gate; a file a later row writes is named here from the start, so the leg fails as `missing <file>` until that row lands.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentMilestone, exists, leg, node, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  benchUnder,
  changesetsCoverRange,
  checkBacklogDone,
  checkFinalReview,
  imageRunner,
  loadMilestoneReviews,
  playwrightSpecs,
  verifyLeg,
  vitestNamed,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);

/** A Vitest file that exists and whose tests all pass: none skipped or todo, at least one run. */
function vitestFile(file, project = 'node', config = undefined) {
  if (!exists(file)) return `missing ${file}`;
  const dir = mkdtempSync(join(tmpdir(), 'm17-vt-'));
  try {
    const out = join(dir, 'report.json');
    const r = run('pnpm', [
      'exec',
      'vitest',
      'run',
      ...(config === undefined ? ['--project', project] : ['--config', config]),
      '--reporter=json',
      `--outputFile=${out}`,
      file,
    ]);
    if (!existsSync(out)) return `vitest wrote no report: ${ok(r)}`;
    const rep = JSON.parse(readFileSync(out, 'utf8'));
    if (rep.numFailedTestSuites > 0) return `${file} failed to run`;
    const tests = rep.testResults.flatMap((f) => f.assertionResults);
    const bad = tests.filter((a) => a.status !== 'passed');
    if (bad.length) return `${bad.length} test(s) not passed in ${file}: ${bad[0].title}`;
    return tests.length > 0 || `${file}: no tests ran`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** `file`'s tests all pass and its text names every one of `goldens` as `golden <id>`, so a missing golden fails by name. */
function vitestGoldens(file, goldens) {
  if (!exists(file)) return `missing ${file}`;
  const text = readFileSync(repoPath(file), 'utf8');
  const absent = goldens.filter((g) => !text.includes(`golden ${g}`));
  if (absent.length) return `${file} has no test of golden ${absent.join(', ')}`;
  return vitestFile(file);
}
const adr = (n, status = 'accepted') => {
  const dir = repoPath('docs/architecture/decisions');
  const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`));
  if (!file) return `missing ADR-${n}`;
  return new RegExp(`^status: ${status}\\b`, 'm').test(readFileSync(join(dir, file), 'utf8')) || `ADR-${n} is not ${status}`;
};
const threshold = (name, value) => {
  try {
    return t(name) === value || `${name} is ${t(name)}, expected ${value}`;
  } catch {
    return `${name} is not in thresholds.mjs`;
  }
};

// ── requirements and decisions ─────────────────────────────────────────────────────────────────────
leg('check-trace --milestone M17 --priority M,S green: every requirement of the plan has a test naming it', () =>
  ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M17', '--priority', 'M,S'])),
);
for (const [n, what] of [
  ['0045', 'layout suite v2 backing libraries'],
  ['0046', 'live containers and incremental mode'],
  ['0047', 'smart template format'],
])
  leg(`ADR-${n} (${what}) is accepted`, () => adr(n));
leg('LAYOUT_INCREMENTAL_MOVED_PCT (30, weakens up) is in thresholds.mjs', () => threshold('LAYOUT_INCREMENTAL_MOVED_PCT', 30));

// ── the algorithms ─────────────────────────────────────────────────────────────────────────────────
// each test file names its fixture as `golden <id>` in a passing test (goldens are inline, as layered.test.ts has them)
const ALGORITHMS = [
  ['tree', 'tree and orgchart: no overlap, parents above children', 'tree-org-40'],
  ['radial', 'radial', 'radial-30'],
  ['mindmap', 'mindmap: two balanced sides', 'mindmap-25'],
  ['force', 'force: the same seed gives the same boxes, no overlap after the post-pass', null],
  ['circular', 'circular', 'circular-12'],
  ['packing', 'packing: fills at least 70 % of the frame', 'packing-50'],
  ['timeline', 'timeline: lanes', 'timeline-lanes'],
  ['swimlane', 'swimlane: nodes stay in their lane', 'swimlane-3x4'],
];
for (const [file, what, golden] of ALGORITHMS)
  leg(`${what}${golden ? `, golden ${golden}` : ''} (FR-LAY-003)`, () => vitestGoldens(`packages/layout/src/${file}.test.ts`, golden ? [golden] : []));
leg('the constraints post-pass keeps pins fixed and aligned nodes on one coordinate (FR-LAY-006)', () => vitestFile('packages/layout/src/constraints.test.ts'));
leg('adding one node moves at most LAYOUT_INCREMENTAL_MOVED_PCT % of the nodes (FR-LAY-006)', () => vitestFile('packages/layout/src/incremental.test.ts'));
// handed off from M16 (roadmap Deferred): the counterexample its verify leg met, pinned by its seed
leg('two paths intersect symmetrically with every point on both, at the seed M16 met (FR-CON-001)', () =>
  vitestNamed('FR-CON-001: intersection is symmetric and every point lies on both paths', ['packages/geometry/src/intersections.test.ts'], {
    env: { FC_SEED: '1847412959' },
  }),
);
leg('tidy leaves no overlap and moves each node within its bound (FR-LAY-011)', () => vitestFile('packages/layout/src/tidy.test.ts'));
leg('fit puts every box inside the safe area (FR-LAY-012)', () => vitestFile('packages/layout/src/fit.test.ts'));
leg('every new layout has benches at 100 and 500 nodes (NFR-PERF-001)', () => {
  const missing = ALGORITHMS.flatMap(([name]) => [100, 500].map((n) => `packages/layout/bench/${name}-${n}.bench.ts`)).filter((f) => !exists(f));
  return missing.length === 0 || `missing benches: ${missing.join(', ')}`;
});
leg('tree, radial and mindmap lay out 500 nodes within LAYOUT_500_NODES_MS', () => {
  for (const name of ['tree', 'radial', 'mindmap']) {
    const r = benchUnder(`packages/layout/bench/${name}-500.bench.ts`, `${name}-500`, t('LAYOUT_500_NODES_MS'));
    if (r !== true) return r;
  }
  return true;
});

// ── templates ──────────────────────────────────────────────────────────────────────────────────────
const TEMPLATES = ['process', 'cycle', 'hierarchy.org', 'pyramid', 'matrix.2x2', 'venn', 'funnel', 'timeline.milestones', 'comparison'];
leg('every smart template builds from an items list and renders to its golden, with its theme variants (FR-LAY-014)', () =>
  vitestGoldens('packages/layout/src/templates/templates.test.ts', TEMPLATES),
);
leg('the templates example compiles and renders to its golden (FR-LAY-014)', () => {
  for (const f of ['examples/dsl/templates.flux.yaml', 'examples/dsl/__golden__/templates.svg']) if (!exists(f)) return `missing ${f}`;
  if (!readFileSync(repoPath('scripts/dsl/examples.test.ts'), 'utf8').includes("matchesGolden('templates')"))
    return "scripts/dsl/examples.test.ts draws no templates golden (matchesGolden('templates'))";
  return vitestFile('scripts/dsl/examples.test.ts', 'node', 'scripts/dsl/examples.config.ts');
});
leg('every registered template is built on a screen of the templates-all example and drawn as its golden (FR-LAY-014)', () => {
  for (const f of ['examples/dsl/templates-all.flux.yaml', 'examples/dsl/__golden__/templates-all.svg']) if (!exists(f)) return `missing ${f}`;
  const text = readFileSync(repoPath('examples/dsl/templates-all.flux.yaml'), 'utf8');
  // every registered id, matched as a whole `template: <id>` line (so process.chevron does not stand in for process.basic)
  const ids = [
    'process.basic',
    'process.chevron',
    'cycle.basic',
    'hierarchy.org',
    'pyramid',
    'matrix.2x2',
    'venn',
    'funnel',
    'timeline.milestones',
    'comparison',
  ];
  const lines = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  const absent = ids.filter((id) => !lines.has(`template: ${id}`));
  return absent.length ? `templates-all.flux.yaml builds no screen of ${absent.join(', ')}` : true;
});
leg('the AI catalog lists every template within its token budget (FR-LAY-014)', () =>
  vitestNamed('FR-LAY-014: the catalog lists all 9 templates within AI_CATALOG_MAX_TOKENS', ['packages/dsl/src/catalog/token-budget.test.ts']),
);

// ── the editor ─────────────────────────────────────────────────────────────────────────────────────
leg('a live layout frame re-lays out when a node is added, and one undo takes both back, on three browsers (FR-LAY-010)', () =>
  playwrightSpecs(['e2e/layout.live-container.spec.ts'], ['chromium', 'firefox', 'webkit'], { runner: imageRunner() }),
);
leg('the layout picker switches a selection from layered to radial, on three browsers (FR-LAY-003)', () =>
  playwrightSpecs(['e2e/layout.picker.spec.ts'], ['chromium', 'firefox', 'webkit'], { runner: imageRunner() }),
);
leg('the layout options form is built from the options schema, for Arrange and for a layout spec (FR-LAY-001, M13 cp1 F3)', () =>
  vitestFile('packages/editor/src/layout-options-form.browser.test.tsx', 'browser'),
);
leg('end users reach the AI panel: key entry, an OpenAI-compatible base URL and the external-assets toggle (M15 final F3)', () =>
  playwrightSpecs(['e2e/ai.panel-settings.spec.ts'], ['chromium']),
);

// ── the ELK pack ───────────────────────────────────────────────────────────────────────────────────
leg('packs/layouts-elk registers ELK layouts only when installed (FR-LAY-003, NFR-LIC-002)', () => {
  if (!exists('packs/layouts-elk/package.json')) return 'missing packs/layouts-elk/package.json';
  return vitestFile('packs/layouts-elk/src/index.test.ts');
});
leg('check-licenses passes with elkjs only in packs/layouts-elk', () => {
  const r = node('scripts/gates/check-licenses.mjs', []);
  if (r.status !== 0) return ok(r);
  const users = run('git', ['grep', '-l', '"elkjs"', '--', '*package.json']).stdout.split(/\r?\n/).filter(Boolean);
  if (users.length === 0) return 'no package depends on elkjs yet';
  return users.every((p) => p === 'packs/layouts-elk/package.json') || `elkjs is a dependency outside the pack: ${users.join(', ')}`;
});

// ── coverage, changesets, quarantines ──────────────────────────────────────────────────────────────
leg('packages/layout coverage is at least 90 % lines and 85 % branches', () => {
  const r = run('pnpm', ['exec', 'vitest', 'run', '--project', 'node', '--coverage', '--coverage.include=packages/layout/src/**', 'packages/layout']);
  if (r.status !== 0) return `layout tests failed: ${ok(r)}`;
  const s = json('coverage/coverage-summary.json')?.total;
  if (!s) return 'no coverage summary written';
  return (s.lines.pct >= 90 && s.branches.pct >= 85) || `layout coverage ${s.lines.pct}% lines / ${s.branches.pct}% branches`;
});
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M17\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M17 commits yet';
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
leg('pnpm verify exits 0 with every planned step PASS (size-limit keeps the player under PLAYER_CORE_GZIP)', () => verifyLeg(VERIFY_STEPS));
leg('CI green on ubuntu, windows and macos at or after the M17 final review range', () => {
  if (!exists('.harness/reviews/milestone-M17-final.json')) return 'no M17 final review yet: its range end is what the evidence must cover';
  return ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M17']));
});
// the layout benches and every @perf spec hold on the CI perf runner (M16 final F3)
leg('the nightly perf job green at or after the M17 final review range', () => {
  if (!exists('.harness/reviews/milestone-M17-final.json')) return 'no M17 final review yet: its range end is what the evidence must cover';
  return ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M17', '--perf']));
});
leg('every M17 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M17'), 'M17', loadMilestoneReviews('M17')));
leg('final milestone review covers M17', () => {
  const rev = json('.harness/reviews/milestone-M17-final.json');
  return rev ? checkFinalReview(rev, 'M17') : 'missing .harness/reviews/milestone-M17-final.json';
});
leg(
  'roadmap advanced past M17',
  () => (currentMilestone() !== null && !/^M(\d|1[0-7])$/.test(currentMilestone())) || `roadmap Current milestone is ${currentMilestone()}`,
);

await runLegs('m17');
