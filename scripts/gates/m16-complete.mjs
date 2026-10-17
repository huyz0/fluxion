#!/usr/bin/env node
// Completion gate for M16 — anchors & smart routing, the R3 exit (docs/milestones/M16.md). Written first and red (M16.1). Each leg runs the real test, bench,
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
  loadMilestoneReviews,
  playwrightSpecs,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);

/** A Vitest file that exists and whose tests all pass: none skipped or todo, at least one run. */
function vitestFile(file, project = 'node') {
  if (!exists(file)) return `missing ${file}`;
  const dir = mkdtempSync(join(tmpdir(), 'm16-vt-'));
  try {
    const out = join(dir, 'report.json');
    const r = run('pnpm', ['exec', 'vitest', 'run', '--project', project, '--reporter=json', `--outputFile=${out}`, file]);
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
leg('check-trace --milestone M16 --priority M,S green: every requirement of the plan has a test naming it', () =>
  ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M16', '--priority', 'M,S'])),
);
leg('check-trace --increment R3 green: every Must requirement of R3 has a test naming it', () =>
  ok(node('scripts/gates/check-trace.mjs', ['--increment', 'R3'])),
);
for (const [n, what] of [
  ['0042', 'orthogonal router'],
  ['0043', 'anchor model and auto-selection'],
  ['0044', 'incremental and global routing'],
])
  leg(`ADR-${n} (${what}) is accepted`, () => adr(n));
leg(
  'ROUTE_DRAG_200_MIN_FPS (50, weakens down), BIG_SCREEN_PANZOOM_MIN_FPS (50) and BIG_SCREEN_FIRST_RENDER_MS (1000) are in thresholds.mjs',
  () =>
    [threshold('ROUTE_DRAG_200_MIN_FPS', 50), threshold('BIG_SCREEN_PANZOOM_MIN_FPS', 50), threshold('BIG_SCREEN_FIRST_RENDER_MS', 1000)].find(
      (r) => r !== true,
    ) ?? true,
);

// ── anchors and the router ─────────────────────────────────────────────────────────────────────────
leg('every anchor kind resolves its point and normal; maxConnections spills (FR-ANC-003, FR-ANC-007)', () =>
  vitestFile('packages/routing/src/anchors.test.ts'),
);
leg('the sparse grid matches its goldens (FR-CON-004)', () => vitestFile('packages/routing/src/orthogonal/grid.test.ts'));
leg('orthogonal routes are axis-aligned and avoid obstacles; nudge keeps spacing (FR-CON-004, FR-RTE-003)', () =>
  vitestFile('packages/routing/src/orthogonal/orthogonal.prop.test.ts'),
);
leg('auto anchors leave no avoidable crossings and do not flicker (FR-ANC-004)', () => vitestFile('packages/routing/src/auto-anchor.test.ts'));
leg('parallel connectors fan out; a connector attaches to a connector (FR-CON-011, FR-CON-009)', () => vitestFile('packages/routing/src/parallel.test.ts'));
leg('line jumps draw an arc at a crossing, cached per route revision (FR-CON-008)', () => vitestFile('packages/routing/src/jumps.test.ts'));
leg('labels do not overlap shapes where the router supports labels (FR-LAY-004)', () => vitestFile('packages/routing/src/label-placement.test.ts'));
leg('the routers are byte-deterministic: straight, curved, orthogonal, polyline (FR-RTE-004)', () => vitestFile('packages/routing/src/determinism.test.ts'));
leg('a router path that misses the target is rejected (FR-RTE-001)', () => vitestFile('packages/routing/src/router.test.ts'));
leg('incremental reroute touches only the affected connectors; a stale worker result is dropped (FR-RTE-002, FR-RTE-003)', () =>
  vitestFile('packages/routing/src/incremental.test.ts'),
);

// ── performance ────────────────────────────────────────────────────────────────────────────────────
leg(`200 orthogonal routes within ROUTE_200_ORTHO_MS (${t('ROUTE_200_ORTHO_MS')} ms) (NFR-PERF-005)`, () =>
  benchUnder('packages/routing/bench/route-200.bench.ts', 'route-200', t('ROUTE_200_ORTHO_MS')),
);
leg('dragging a shape with 200 connectors holds ROUTE_DRAG_200_MIN_FPS (FR-RTE-002)', () => playwrightSpecs(['e2e/perf.route-drag-200.spec.ts'], ['chromium']));
leg('a 2k-element, 1k-connector screen pans and zooms at BIG_SCREEN_PANZOOM_MIN_FPS and first-renders under BIG_SCREEN_FIRST_RENDER_MS (NFR-PERF-002)', () => {
  if (!exists('examples/perf/2k-1k.flux.json')) return 'missing examples/perf/2k-1k.flux.json';
  return playwrightSpecs(['e2e/perf.big-screen.spec.ts'], ['chromium']);
});

// ── the editor ─────────────────────────────────────────────────────────────────────────────────────
leg('a drop near an anchor snaps and a custom anchor persists after save and reopen, on three browsers (FR-ANC-005, FR-ANC-006)', () =>
  playwrightSpecs(['e2e/anchors.snap-and-custom.spec.ts'], ['chromium', 'firefox', 'webkit']),
);
leg('dragging a curve tangent handle changes the curve in one undo step; the migration fixture round-trips (FR-CON-007)', () =>
  playwrightSpecs(['e2e/connectors.tangent.spec.ts'], ['chromium']),
);

// ── the showcase and the exit ──────────────────────────────────────────────────────────────────────
leg('the routing showcase compiles and renders to its golden with hops and fanned connectors', () => {
  if (!exists('examples/dsl/routing-showcase.flux.yaml')) return 'missing examples/dsl/routing-showcase.flux.yaml';
  return vitestFile('scripts/examples/routing-showcase.test.ts');
});
leg('the R3 exit checklist lists every criterion with evidence', () => {
  if (!exists('docs/milestones/exits/R3.md')) return 'missing docs/milestones/exits/R3.md';
  const rows = readFileSync(repoPath('docs/milestones/exits/R3.md'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\|.*\]\(.+\)/.test(l));
  if (rows.length < 6) return `only ${rows.length} checklist rows with an evidence link (< 6)`;
  const dead = rows
    .flatMap((l) => [...l.matchAll(/\]\(([^)#]+)\)/g)].map((m) => m[1]))
    .filter((href) => !/^[a-z]+:/.test(href) && !exists(join('docs/milestones/exits', href)));
  return dead.length === 0 || `evidence links that resolve to nothing: ${dead.join(', ')}`;
});

// ── coverage, changesets, quarantines ──────────────────────────────────────────────────────────────
leg('packages/routing coverage is at least 90 % lines and 85 % branches', () => {
  const r = run('pnpm', ['exec', 'vitest', 'run', '--project', 'node', '--coverage', '--coverage.include=packages/routing/src/**', 'packages/routing']);
  if (r.status !== 0) return `routing tests failed: ${ok(r)}`;
  const s = json('coverage/coverage-summary.json')?.total;
  if (!s) return 'no coverage summary written';
  return (s.lines.pct >= 90 && s.branches.pct >= 85) || `routing coverage ${s.lines.pct}% lines / ${s.branches.pct}% branches`;
});
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M16\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M16 commits yet';
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
leg('CI green on ubuntu, windows and macos at or after the M16 final review range', () => {
  if (!exists('.harness/reviews/milestone-M16-final.json')) return 'no M16 final review yet: its range end is what the evidence must cover';
  return ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M16']));
});
leg('every M16 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M16'), 'M16', loadMilestoneReviews('M16')));
leg('final milestone review covers M16', () => {
  const rev = json('.harness/reviews/milestone-M16-final.json');
  return rev ? checkFinalReview(rev, 'M16') : 'missing .harness/reviews/milestone-M16-final.json';
});
leg(
  'roadmap advanced past M16',
  () => (currentMilestone() !== null && !/^M(\d|1[0-6])$/.test(currentMilestone())) || `roadmap Current milestone is ${currentMilestone()}`,
);

await runLegs('m16');
