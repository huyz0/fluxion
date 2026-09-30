#!/usr/bin/env node
// Completion gate for M6 — Editor shell, canvas & selection (docs/milestones/M6.md).
// Written first and red (M6.1). Legs are behavioural: each runs the real test, spec or gate.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInImage } from '../e2e/image.mjs';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import * as checks from './milestone-checks.mjs';
import {
  backlogTextFor,
  checkBacklogDone,
  checkFinalReview,
  checkPlaywrightReport,
  checkPlaywrightTitles,
  coverageGaps,
  dockerAvailable,
  loadMilestoneReviews,
  namedCases,
  playwrightReport,
  readmeGaps,
  titled,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const pnpm = (...a) => run('pnpm', a);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);
/** Source text without comments, so a commented-out call never satisfies a leg. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const DESKTOP = ['chromium', 'firefox', 'webkit'];
const MOBILE = ['mobile-chrome', 'mobile-safari'];
const PERF = ['perf'];
const EDITOR = 'editor';
const browser = (row, title, pkg = EDITOR) => [row, title, pkg, {}, 'browser'];

// ── E2E: every spec of a project group runs once per gate, then each leg judges its specs ─────────
// In ci.yml's pinned image through Docker when it is available (the browsers CI uses, on any host),
// else with the local browsers; FLUXION_E2E=local forces the local ones.
const GROUPS = {
  desktop: {
    projects: DESKTOP,
    specs: [
      'e2e/smoke.studio-boots.spec.ts',
      'e2e/editor.boot.spec.ts',
      'e2e/editor.layout-persists.spec.ts',
      'e2e/canvas.pan-zoom.spec.ts',
      'e2e/tools.select-hand.spec.ts',
      ...['shape', 'text', 'frame', 'image', 'connector', 'pen', 'freehand'].map((tool) => `e2e/tools.${tool}.spec.ts`),
      'e2e/selection.marquee.spec.ts',
      'e2e/move.nudge-and-duplicate.spec.ts',
      'e2e/transform.resize-rotate-undo.spec.ts',
      'e2e/present.mode-switch.spec.ts',
      'e2e/parity.edit-vs-present.spec.ts',
      'e2e/a11y.editor-shell.spec.ts',
    ],
  },
  mobile: { projects: MOBILE, specs: ['e2e/touch.edit-basics.spec.ts'] },
  // the drag benchmark measures frames: its own chromium project (@perf), one worker, nothing beside it
  perf: { projects: PERF, specs: ['e2e/perf.drag-500.spec.ts'], workers: 1 },
};
const reports = new Map();
const runner = () =>
  process.env.FLUXION_E2E !== 'local' && dockerAvailable() ? (args, env) => runInImage(args, { report: env.PLAYWRIGHT_JSON_OUTPUT_NAME }) : undefined;
/** Whether `specs` pass on `projects` in their group's one run; a missing spec fails first. */
function e2e(specs, projects) {
  const missing = specs.filter((s) => !exists(s));
  if (missing.length) return `missing ${missing.join(', ')}`;
  const report = groupReport(projects);
  return typeof report === 'string' ? report : checkPlaywrightReport(report, specs, projects);
}

/** The report of the group `projects` belong to, run once per gate. */
function groupReport(projects) {
  const group = projects === MOBILE ? 'mobile' : projects === PERF ? 'perf' : 'desktop';
  if (!reports.has(group)) {
    const { specs: all, projects: ps, workers } = GROUPS[group];
    const present = all.filter((s) => exists(s));
    const r = runner();
    reports.set(group, playwrightReport(present, ps, { ...(r ? { runner: r } : {}), ...(workers === undefined ? {} : { workers }) }));
  }
  return reports.get(group);
}

leg('check-trace --milestone M6 green', () => ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M6'])));

// ── decisions (plan "Decide before coding"; M5 final F4: numbers that collide with M5's moved) ──────
/** The accepted ADR `num` whose title names `words` (a number alone could be another decision). */
function adrLeg(num, words) {
  const dir = 'docs/architecture/decisions';
  const file = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', dir])
    .stdout.split(/\r?\n/)
    .find((f) => f.startsWith(`${dir}/${num}-`));
  if (!file) return `no ${num} in ${dir}`;
  const text = readText(file);
  const title = /^# .*$/m.exec(text)?.[0] ?? '';
  if (!words.every((w) => title.toLowerCase().includes(w))) return `${file}: title "${title}" does not name ${words.join(' ')}`;
  return /^status:\s*accepted\s*$/m.test(text) || `${file} is not accepted`;
}
leg('ADR-0028 editor interaction architecture is accepted', () => adrLeg('ADR-0028', ['editor', 'interaction']));
leg('ADR-0029 editor chrome primitives is accepted', () => adrLeg('ADR-0029', ['editor', 'chrome']));
leg('M6 plan cites the renumbered ADRs (M5 final F4)', () => {
  const plan = readText('docs/milestones/M6.md');
  return (!/^- ADR-001[789]:/m.test(plan) && /^- ADR-0028:/m.test(plan) && /^- ADR-0029:/m.test(plan)) || 'M6.md still plans ADR-0017/0018';
});

// ── studio shell, layout, session and camera (plan rows 2-5) ────────────────────────────────────
// behavioural (M6.1 review F2): the studio depends on the pack, and the boot spec, which the next leg
// runs, proves a fixture's basic shapes are drawn by it rather than as placeholders
const PACK_TITLE = 'FR-EDT-001: a fixture opens with its basic shapes drawn, no placeholder';
leg('the studio bundles packs/basic and draws its shapes (M5 hand-off, ADR-0017)', () => {
  const pkg = json('apps/studio/package.json');
  if (!pkg?.dependencies?.['@fluxion/pack-basic']) return 'apps/studio does not depend on @fluxion/pack-basic';
  const spec = 'e2e/editor.boot.spec.ts';
  if (!exists(spec)) return `missing ${spec}`;
  return code(readText(spec)).includes(PACK_TITLE) || `${spec} has no test "${PACK_TITLE}"`;
});
leg('studio boots /edit/new to an empty 16:9 screen (editor.boot)', () => e2e(['e2e/editor.boot.spec.ts'], DESKTOP));
leg('panel layout persists across a reload (editor.layout-persists)', () => e2e(['e2e/editor.layout-persists.spec.ts'], DESKTOP));
leg('session state is never saved; camera math clamps and anchors zoom', () =>
  titled([
    ['M6.6', 'FR-EDT-004: a saved document snapshot holds no session keys', EDITOR],
    ['M6.7', 'FR-EDT-002: zoom stays within 5 % and 3200 % and keeps the point under the cursor still', EDITOR],
  ]),
);
leg('canvas pans and zooms, clamped to 5 %-3200 % (canvas.pan-zoom)', () => e2e(['e2e/canvas.pan-zoom.spec.ts'], DESKTOP));

// ── pipeline, hit-testing and tools (plan rows 6-9) ───────────────────────────────────────────────
leg('pointer pipeline batches to one store diff per frame; hit-testing; Esc returns to select', () =>
  titled([
    ['M6.9', 'FR-EDT-003: a drag stream commits at most one store diff per frame', EDITOR],
    ['M6.10', 'FR-EDT-004: rotated, hollow and thin-stroke shapes hit where they are drawn', EDITOR],
    ['M6.11', 'FR-EDT-003: Esc returns any tool to select', EDITOR],
  ]),
);
leg(`hit-test-2000 bench within HIT_TEST_2000_MAX_MS (${t('HIT_TEST_2000_MAX_MS')} ms)`, () =>
  typeof checks.benchUnder === 'function'
    ? checks.benchUnder('packages/editor/bench/hit-test-2000.bench.ts', 'hit-test-2000', t('HIT_TEST_2000_MAX_MS'))
    : 'milestone-checks.mjs exports no benchUnder (M6.10)',
);
leg('select and hand tools; Esc returns to select (tools.select-hand)', () => e2e(['e2e/tools.select-hand.spec.ts'], DESKTOP));
const CREATION_TOOLS = ['shape', 'text', 'frame', 'image', 'connector', 'pen', 'freehand'];
leg('each creation tool creates one element, undoable in one step (tools.<tool>)', () =>
  e2e(
    CREATION_TOOLS.map((tool) => `e2e/tools.${tool}.spec.ts`),
    DESKTOP,
  ),
);

// ── overlay, selection and transforms (plan rows 10-13) ───────────────────────────────────────────
leg('overlay handles keep their size; dragging re-renders one element and the overlay (T1)', () =>
  titled([
    browser('M6.12', 'FR-EDT-004: handles stay 8 px at 25 % and 400 % zoom'),
    browser('M6.14', 'FR-EDT-005: dragging one element re-renders only that element and the overlay'),
  ]),
);
leg('resize and rotate geometry per handle (T0)', () =>
  titled([
    ['M6.15', 'FR-EDT-004: every resize handle moves its edges; shift keeps the aspect, alt resizes about the centre', EDITOR],
    ['M6.15', 'FR-EDT-004: shift snaps rotation to 15° steps', EDITOR],
  ]),
);
leg('marquee selects by contain and by intersect (selection.marquee)', () => e2e(['e2e/selection.marquee.spec.ts'], DESKTOP));
leg('move, nudge and alt-drag duplicate (move.nudge-and-duplicate)', () => e2e(['e2e/move.nudge-and-duplicate.spec.ts'], DESKTOP));
leg('resize and rotate are one undo step each (transform.resize-rotate-undo)', () => e2e(['e2e/transform.resize-rotate-undo.spec.ts'], DESKTOP));

// ── touch, mode switch, parity, performance (plan rows 14-17) ─────────────────────────────────────
leg('touch editing basics on both mobile projects (touch.edit-basics)', () => e2e(['e2e/touch.edit-basics.spec.ts'], MOBILE));
/** A spec that passes and has a passing test under each of `titles` on every project (cp1 F4). */
function titledSpec(spec, projects, titles) {
  const passed = e2e([spec], projects);
  return passed === true ? checkPlaywrightTitles(groupReport(projects), spec, titles, projects) : passed;
}
// the laser is drawn while presenting, with no edit chrome (M6 cp2 F1)
const PRESENT_TITLES = ['FR-EDT-003: while presenting, the pointer draws the laser trail and no edit chrome'];
leg('F5 presents in place; input while presenting never changes the document; the laser draws (present.mode-switch)', () =>
  titledSpec('e2e/present.mode-switch.spec.ts', DESKTOP, PRESENT_TITLES),
);
/**
 * A spec that passes, reads its bound from thresholds.mjs (a literal would drift from it), and has a
 * passing test under each of `titles`: the conditions the plan names, not only a passing file (cp1 F4).
 */
function thresholdSpec(spec, key, projects, titles) {
  if (!exists(spec)) return `missing ${spec}`;
  if (!code(readText(spec)).includes(key)) return `${spec} does not read ${key} from thresholds.mjs`;
  const passed = e2e([spec], projects);
  if (passed !== true) return passed;
  return checkPlaywrightTitles(groupReport(projects), spec, titles, projects);
}
// the plan's conditions (M6.md rows 16-17), pinned by title: the specs must prove them, not only pass
const PARITY_TITLES = [
  'FR-EDT-010: with an empty selection and the overlay unmounted, each fixture screen draws the same pixels in edit and present',
  'FR-EDT-010: the content layer DOM is equal in edit and present after the allowlist',
];
const PERF_TITLES = ['NFR-PERF-001: dragging one element among 500 keeps at least EDITOR_DRAG_MIN_FPS over the measured frames'];
leg(`edit and present draw the same pixels within PARITY_MAX_DIFF_PCT (${t('PARITY_MAX_DIFF_PCT')} %)`, () =>
  thresholdSpec('e2e/parity.edit-vs-present.spec.ts', 'PARITY_MAX_DIFF_PCT', DESKTOP, PARITY_TITLES),
);
leg(`dragging 1 of 500 elements stays at or above EDITOR_DRAG_MIN_FPS (${t('EDITOR_DRAG_MIN_FPS')})`, () => {
  const doc = json('fixtures/docs/perf-500.flux.json');
  const elements = Object.values(doc?.records ?? {}).filter((r) => r.type === 'element').length;
  if (elements < 500) return `fixtures/docs/perf-500.flux.json has ${elements} elements (< 500)`;
  return thresholdSpec('e2e/perf.drag-500.spec.ts', 'EDITOR_DRAG_MIN_FPS', PERF, PERF_TITLES);
});
leg('axe finds no serious or critical issue on the editor shell (a11y.editor-shell)', () => e2e(['e2e/a11y.editor-shell.spec.ts'], DESKTOP));

// ── coverage and docs (plan row 18) ─────────────────────────────────────────────────────────────────
leg(`packages/editor coverage at or above COVERAGE_EDITOR_LINES/BRANCHES`, () => {
  const out = mkdtempSync(join(tmpdir(), 'm6-cov-'));
  try {
    // the exit status also carries the other packages' global thresholds: judge this package's tests and numbers
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
      'packages/editor',
    );
    if (!existsSync(report)) return `vitest wrote no report: ${ok(r)}`;
    const { numFailedTests, numPassedTests } = JSON.parse(readFileSync(report, 'utf8'));
    if (numFailedTests > 0 || numPassedTests === 0) return `packages/editor: ${numFailedTests} failed, ${numPassedTests} passed`;
    const summary = join(out, 'coverage-summary.json');
    if (!existsSync(summary)) return `no coverage summary: ${ok(r)}`;
    return coverageGaps(
      JSON.parse(readFileSync(summary, 'utf8')),
      'packages/editor',
      { lines: t('COVERAGE_EDITOR_LINES'), branches: t('COVERAGE_EDITOR_BRANCHES') },
      300,
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
leg('docs: the Canvas basics guide, toolbar and panel stories, editor AGENTS.md describe M6', () => {
  const guide = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'apps/docs'])
    .stdout.split(/\r?\n/)
    .find((f) => /canvas-basics\.mdx?$/.test(f));
  if (!guide) return 'no apps/docs canvas-basics guide';
  const gaps = [
    [guide, ['pan', 'zoom', 'marquee', 'Shift', 'Alt', 'F5', 'Esc']],
    ['packages/editor/AGENTS.md', ['session', 'camera', 'tools', 'overlay', 'hit']],
  ].flatMap(([f, names]) => {
    const r = exists(f) ? readmeGaps(readText(f), names) : 'missing';
    return r === true ? [] : [`${f}: ${r}`];
  });
  const stories = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'packages/editor/src'])
    .stdout.split(/\r?\n/)
    .filter((f) => f.endsWith('.stories.tsx'));
  for (const name of ['toolbar', 'panel']) if (!stories.some((f) => f.toLowerCase().includes(name))) gaps.push(`no ${name} story in packages/editor/src`);
  return gaps.length === 0 || gaps.join('; ');
});

leg('changesets cover every package the milestone range changed (M4 final F1; M6.1 review r2 F1)', () => {
  if (typeof checks.changesetsCoverRange !== 'function') return 'milestone-checks.mjs exports no changesetsCoverRange';
  const first = run('git', ['rev-list', '--reverse', '--grep=^M6\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? checks.changesetsCoverRange(`${first}~1`) : 'no M6 commits yet';
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
leg('no open test quarantines', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.includes('tests/harness/'));
  return hits.length === 0 || `open quarantines: ${hits.slice(0, 3).join(' | ')}`;
});
leg('CI green on ubuntu, windows and macos, visual job included, at or after the M6 final review range', () => {
  // evidence recorded for an earlier milestone can sit at or after HEAD before M6 has a commit of its own
  if (!exists('.harness/reviews/milestone-M6-final.json')) return 'no M6 final review yet: its range end is what the evidence must cover';
  const unit = namedCases('tests/harness/ci-evidence.test.mjs', ['evidence without a green visual job fails']);
  return unit === true ? ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M6'])) : unit;
});
leg('every M6 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M6'), 'M6', loadMilestoneReviews('M6')));
leg('final milestone review covers M6', () => {
  const rev = json('.harness/reviews/milestone-M6-final.json');
  return rev ? checkFinalReview(rev, 'M6') : 'missing .harness/reviews/milestone-M6-final.json';
});
leg(
  'roadmap advanced past M6',
  () => !['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'].includes(currentMilestone()) || `roadmap Current milestone is ${currentMilestone()}`,
);

await runLegs('m6');
