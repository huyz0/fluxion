#!/usr/bin/env node
// Completion gate for M8 — Arrange, screens & library v1 (docs/milestones/M8.md). Written first and red
// (M8.1). Legs are behavioural: each runs the real test, spec, bench or gate. The E2E groups and the
// performance legs are shared with the other editor gates (editor-gate.mjs).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createE2e, DESKTOP, editorPerfLegs, PERF_GROUP } from './editor-gate.mjs';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  benchUnder,
  changesetsCoverRange,
  checkBacklogDone,
  checkFinalReview,
  coverageGaps,
  loadMilestoneReviews,
  namedCases,
  readmeGaps,
  titled,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const pnpm = (...a) => run('pnpm', a);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);
const EDITOR = 'editor';
const CORE = 'core';
const browser = (row, title, pkg = EDITOR) => [row, title, pkg, {}, 'browser'];
const EXAMPLE = 'examples/arrange-demo.flux.json';
const GUIDE = 'apps/docs/src/content/docs/guides/screens-and-arranging.md';

const { e2e, titledSpec, thresholdSpec } = createE2e({
  desktop: {
    projects: DESKTOP,
    specs: [
      'e2e/arrange.group-edit.spec.ts',
      'e2e/arrange.align-distribute-order.spec.ts',
      'e2e/snapping.smart-guides.spec.ts',
      'e2e/screens.navigator.spec.ts',
      'e2e/screens.sections.spec.ts',
      'e2e/screens.notes.spec.ts',
      'e2e/library.panel.spec.ts',
      'e2e/library.drag-insert.spec.ts',
      'e2e/library.shape-tool.spec.ts',
      'e2e/present.shift-f5.spec.ts',
      'e2e/parity.edit-vs-present.spec.ts',
    ],
  },
  perf: PERF_GROUP,
});

leg('check-trace --milestone M8 green', () => ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M8'])));

// ── decisions ───────────────────────────────────────────────────────────────────────────────────────
leg('ADR-0021 screen sections and the library search index is accepted', () => {
  const dir = 'docs/architecture/decisions';
  const file = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', dir])
    .stdout.split(/\r?\n/)
    .find((f) => f.startsWith(`${dir}/ADR-0021-`));
  if (!file) return `no ADR-0021 in ${dir}`;
  const text = readText(file);
  const title = /^# .*$/m.exec(text)?.[0] ?? '';
  if (!['section', 'search'].every((w) => title.toLowerCase().includes(w))) return `${file}: title "${title}" does not name sections and search`;
  if (!/site/i.test(text)) return `${file} does not name site navigation as a consumer (M8 risk)`;
  return /^status:\s*accepted\s*$/m.test(text) || `${file} is not accepted`;
});

leg('ADR-0151 the group model is accepted and FR-ARR-001 says what is built', () => {
  const dir = 'docs/architecture/decisions';
  const file = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', dir])
    .stdout.split(/\r?\n/)
    .find((f) => f.startsWith(`${dir}/ADR-0151-`));
  if (!file) return `no ADR-0151 in ${dir}`;
  if (!/^status:\s*accepted\s*$/m.test(readText(file))) return `${file} is not accepted`;
  const req = readText('docs/requirements/13-layout-and-arrange.md');
  return /FR-ARR-001[^\n]*bounds of its members/.test(req) || 'FR-ARR-001 does not say a group is the bounds of its members';
});

// ── arranging: groups, align, distribute, z-order (plan rows 2-6) ───────────────────────────────────
leg('group then ungroup restores the children; connectors stay bound (T0 property)', () =>
  titled([
    ['M8.4', 'FR-ARR-001: group then ungroup restores every child world box within 1e-6', CORE],
    ['M8.4', 'FR-CON-012: connectors stay attached to children of rotated nested groups', 'routing'],
  ]),
);
leg('a group moves, resizes and rotates as one; double-click enters it (arrange.group-edit)', () => e2e(['e2e/arrange.group-edit.spec.ts'], DESKTOP));
leg(
  'the arrange commands work from the UI: align from the context menu, distribute, and order by key, each undone in one step (arrange.align-distribute-order)',
  () =>
    titledSpec('e2e/arrange.align-distribute-order.spec.ts', DESKTOP, [
      'FR-ARR-002: align left from the context menu lines up three shapes',
      'FR-ARR-003: distribute horizontally spaces them evenly',
      'FR-ARR-004: Ctrl+] brings a shape forward and one undo takes it back',
    ]),
);
leg('align: every mode against selection, key object and screen (T0)', () =>
  titled([['M8.6', 'FR-ARR-002: align places every mode against every reference, rotated shapes by world bounds', CORE]]),
);
leg('distribute leaves equal gaps (T0)', () => titled([['M8.7', 'FR-ARR-003: distribute leaves equal gaps within 1e-6', CORE]]));
leg('bring forward changes exactly one record (T0)', () =>
  titled([['M8.8', 'FR-ARR-004: bringing an element forward changes exactly one record index', CORE]]),
);

// ── snapping (plan rows 7-8) ────────────────────────────────────────────────────────────────────────
leg('snapping: the snapped delta stays within the threshold and the nearest candidate wins (T0 properties)', () =>
  titled([
    ['M8.9', 'FR-ARR-005: a snapped delta never exceeds the threshold of 8 px over the zoom', EDITOR],
    ['M8.9', 'FR-ARR-005: the lowest-distance candidate wins on each axis', EDITOR],
  ]),
);
leg('smart guides appear, the final position is exact, and the toggle turns snapping off (snapping.smart-guides)', () =>
  titledSpec('e2e/snapping.smart-guides.spec.ts', DESKTOP, [
    'FR-ARR-005: guides appear while dragging and the final position is exact',
    'FR-ARR-005: the snapping toggle in the toolbar turns snapping off and the setting persists',
  ]),
);

// ── screens (plan rows 9-13) ────────────────────────────────────────────────────────────────────────
leg('screen commands are undoable; reorder changes one record (T0)', () =>
  titled([
    ['M8.11', 'FR-SCR-002: every screen command is one undo step', CORE],
    ['M8.11', 'FR-SCR-002: reordering a screen changes exactly one record', CORE],
    ['M8.11', 'FR-SCR-002: a duplicated screen has new ids and its internal bindings remapped', CORE],
    ['M8.11', 'FR-SCR-002: a hidden screen is marked and skipped by the next visible screen lookup', CORE],
  ]),
);
leg('the navigator reorders (kept through undo and redo), renames, hides, and opens 50 screens under NAVIGATOR_OPEN_50_MAX_MS (screens.navigator)', () => {
  const spec = 'e2e/screens.navigator.spec.ts';
  const titles = ['FR-SCR-002: a dragged reorder persists through undo and redo', 'FR-SCR-002: a screen is renamed inline and a hidden screen is marked'];
  const timed = thresholdSpec(spec, 'NAVIGATOR_OPEN_50_MAX_MS', DESKTOP, ['NFR-PERF-001: the navigator opens with 50 screens within NAVIGATOR_OPEN_50_MAX_MS']);
  return timed === true ? titledSpec(spec, DESKTOP, titles) : timed;
});
leg('F5 presents the first visible screen and shift+F5 the current one (M6 final F3)', () =>
  titledSpec('e2e/present.shift-f5.spec.ts', DESKTOP, [
    'FR-EDT-009: shift+F5 on a later screen presents that screen',
    'FR-EDT-009: F5 presents the first visible screen',
  ]),
);
leg('the parity suite compares every screen of each example (M6 final F2)', () =>
  titledSpec('e2e/parity.edit-vs-present.spec.ts', DESKTOP, ['FR-EDT-010: every screen of every example draws the same pixels in edit and present']),
);
leg('screen presets draw at the right aspect ratio; an infinite screen presents through a viewport (T1)', () =>
  titled([
    browser('M8.13', 'FR-SCR-003: each screen preset renders at its aspect ratio within 0.5 px'),
    browser('M8.13', 'FR-SCR-003: an infinite screen presents through its viewport'),
  ]),
);
leg('section commands and speaker notes are commands, each one undo step (T0)', () =>
  titled([
    ['M8.29', 'FR-SCR-004: sections are created in order, renamed, folded and moved, each one undo step', CORE],
    ['M8.29', 'FR-SCR-004: a screen moves between sections and out of them, one undo step each', CORE],
    ['M8.29', 'FR-SCR-004: deleting a section lets its screens go, in one undo step', CORE],
    ['M8.16', 'FR-SCR-006: speaker notes are set on a screen and removed again, and only a screen has them', CORE],
  ]),
);
leg('a format change on an infinite screen keeps its viewport (T0)', () =>
  titled([['M8.28', 'FR-SCR-003: a format change on an infinite screen keeps its viewport', EDITOR]]),
);
leg('the sections migration fixture round-trips (T0)', () => titled([['M8.14', 'FR-SCR-004: a document without sections migrates and round-trips', 'schema']]));
leg('screens group into sections in the navigator (screens.sections)', () => e2e(['e2e/screens.sections.spec.ts'], DESKTOP));
leg('speaker notes persist across screen switches and undo (screens.notes)', () => e2e(['e2e/screens.notes.spec.ts'], DESKTOP));

// ── library (plan rows 14-15) ───────────────────────────────────────────────────────────────────────
leg('library search over 10k entries is under LIBRARY_SEARCH_10K_MAX_MS and finds the cylinder', () =>
  benchUnder('packages/editor/bench/library-search-10k.bench.ts', 'library-search-10k', t('LIBRARY_SEARCH_10K_MAX_MS')),
);
leg('the library panel lists the basic pack by category and searches it (library.panel)', () => e2e(['e2e/library.panel.spec.ts'], DESKTOP));
leg('a dragged library item lands within 1 px of the drop (library.drag-insert)', () => e2e(['e2e/library.drag-insert.spec.ts'], DESKTOP));
leg("the shape tool places the library's current item (library.shape-tool, M6 cp2 F2)", () => e2e(['e2e/library.shape-tool.spec.ts'], DESKTOP));
leg('the worst-case staged ladder is what the budget record times (M7 final F4)', () =>
  namedCases('tests/harness/budget.test.mjs', ["NFR-DX-002: the recorded staged time is the worst-case commit's"]),
);

// ── performance, shared with every editor gate ──────────────────────────────────────────────────────
editorPerfLegs(leg, { thresholdSpec });

// ── coverage, docs, example and changesets ──────────────────────────────────────────────────────────
/** A package's coverage over its own Vitest run against `floors` ({lines, branches}). */
function coverageLeg(pkg, floors) {
  const out = mkdtempSync(join(tmpdir(), 'm8-cov-'));
  try {
    const report = join(out, 'report.json');
    const r = pnpm(
      'exec',
      'vitest',
      'run',
      '--coverage',
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory=${out}`,
      '--reporter=json',
      `--outputFile=${report}`,
      pkg,
    );
    if (!existsSync(report)) return `vitest wrote no report: ${ok(r)}`;
    const { numFailedTests, numPassedTests } = JSON.parse(readFileSync(report, 'utf8'));
    if (numFailedTests > 0 || numPassedTests === 0) return `${pkg}: ${numFailedTests} failed, ${numPassedTests} passed`;
    const summary = join(out, 'coverage-summary.json');
    return existsSync(summary) ? coverageGaps(JSON.parse(readFileSync(summary, 'utf8')), pkg, floors, 300) : `no coverage summary: ${ok(r)}`;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
leg('packages/core coverage at or above COVERAGE_PURE_LINES/BRANCHES', () =>
  coverageLeg('packages/core', { lines: t('COVERAGE_PURE_LINES'), branches: t('COVERAGE_PURE_BRANCHES') }),
);
leg('packages/editor coverage at or above COVERAGE_EDITOR_LINES/BRANCHES', () =>
  coverageLeg('packages/editor', { lines: t('COVERAGE_EDITOR_LINES'), branches: t('COVERAGE_EDITOR_BRANCHES') }),
);
leg('docs: the "Screens & arranging" guide and examples/arrange-demo.flux.json (valid, with groups, sections and notes)', () => {
  if (!exists(GUIDE)) return `missing ${GUIDE}`;
  const g = readmeGaps(readText(GUIDE), ['group', 'align', 'section', 'notes', 'library']);
  if (g !== true) return `${GUIDE}: ${g}`;
  if (!exists(EXAMPLE)) return `missing ${EXAMPLE}`;
  const v = run('node', ['packages/cli/dist/bin.js', 'validate', EXAMPLE]);
  return v.status === 0 || `${EXAMPLE} does not validate: ${(v.stdout + v.stderr).trim().split(/\r?\n/).slice(-2).join(' | ')}`;
});
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M8\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M8 commits yet';
});

// ── the tree, CI and the review ─────────────────────────────────────────────────────────────────────
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
leg('no open test quarantines', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.includes('tests/harness/'));
  return hits.length === 0 || `open quarantines: ${hits.slice(0, 3).join(' | ')}`;
});
leg('M7 is closed: its blocked row M7.28 is done (the three-engine run of m7-complete, M8.2)', () => {
  const archive = readText('docs/backlog/archive/M7.md');
  return (
    /\|\s*M7\.28\s*\|.*\|\s*done\s*\|/.test(archive) || 'docs/backlog/archive/M7.md still has M7.28 blocked: run m7-complete on a three-engine machine (M8.2)'
  );
});
leg('CI green on ubuntu, windows and macos, visual job included, at or after the M8 final review range', () => {
  if (!exists('.harness/reviews/milestone-M8-final.json')) return 'no M8 final review yet: its range end is what the evidence must cover';
  const unit = namedCases('tests/harness/ci-evidence.test.mjs', ['evidence without a green visual job fails']);
  return unit === true ? ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M8'])) : unit;
});
leg('every M8 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M8'), 'M8', loadMilestoneReviews('M8')));
leg('final milestone review covers M8', () => {
  const rev = json('.harness/reviews/milestone-M8-final.json');
  return rev ? checkFinalReview(rev, 'M8') : 'missing .harness/reviews/milestone-M8-final.json';
});
leg(
  'roadmap advanced past M8',
  () => !['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'].includes(currentMilestone()) || `roadmap Current milestone is ${currentMilestone()}`,
);

await runLegs('m8');
