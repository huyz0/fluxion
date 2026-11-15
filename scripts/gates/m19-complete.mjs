#!/usr/bin/env node
// M19's executable exit criteria (docs/milestones/M19.md). Missing future files fail; existence alone never
// proves a feature. The row that writes a test keeps its leg's file name or renames it here in the same commit.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  changesetsCoverRange,
  checkBacklogDone,
  checkFinalReview,
  coverageGaps,
  imageRunner,
  loadMilestoneReviews,
  namedCases,
  playwrightSpecs,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const result = (r) => r.status === 0 || (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-4).join(' | ') || `exit ${r.status}`;
const command = (file, args = []) => (exists(file) ? result(node(file, args)) : `missing ${file}`);
const json = (file) => JSON.parse(readText(file));
const BROWSERS = ['chromium', 'firefox', 'webkit'];

// The first failing test's full name and first failure line from a Vitest JSON report (as m18-complete).
function failedTest(out) {
  try {
    const report = JSON.parse(readFileSync(out, 'utf8'));
    const failed = report.testResults.flatMap((suite) => suite.assertionResults ?? []).find((a) => a.status === 'failed');
    if (failed) return `FAIL ${failed.fullName ?? failed.title}: ${String(failed.failureMessages?.[0] ?? '').split(/\r?\n/)[0]}`;
    const suite = report.testResults.find((s) => s.status === 'failed' && s.message);
    return suite ? `FAIL ${suite.name}: ${suite.message.split(/\r?\n/)[0]}` : null;
  } catch {
    return null;
  }
}

// A nonempty report, a successful process and every assertion passed; with `named`, a passed case whose
// full name holds that text, so the leg judges the case it names (M18.244, cp36 F3).
function tests(file, { project = 'node*', config, named } = {}) {
  if (!exists(file)) return `missing ${file}`;
  const dir = mkdtempSync(join(tmpdir(), 'm19-tests-'));
  try {
    const out = join(dir, 'report.json');
    const r = run('pnpm', [
      'exec',
      'vitest',
      'run',
      ...(config ? ['--config', config] : ['--project', project]),
      '--reporter=json',
      `--outputFile=${out}`,
      file,
    ]);
    if (r.status !== 0) return `${file}: ${failedTest(out) ?? result(r)}`;
    const report = JSON.parse(readFileSync(out, 'utf8'));
    const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
    if (!(report.numFailedTestSuites === 0 && assertions.length > 0 && assertions.every((a) => a.status === 'passed')))
      return `${file}: empty, failed, skipped or todo tests`;
    // `named`: one case name or several, each a passed case's full name must hold
    const missing = (named === undefined ? [] : [named].flat()).find((n) => !assertions.some((a) => String(a.fullName ?? a.title ?? '').includes(n)));
    return missing === undefined || `${file}: no passed case named '${missing}'`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const all = (...checks) => {
  for (const check of checks) {
    const r = check();
    if (r !== true) return r;
  }
  return true;
};
function accepted(number) {
  const file = readdirSync(repoPath('docs/architecture/decisions')).find((name) => name.startsWith(`ADR-${number}-`));
  return file ? /^status: accepted\b/m.test(readText(`docs/architecture/decisions/${file}`)) || `ADR-${number} not accepted` : `missing ADR-${number}`;
}
// Each named e2e spec scans with axe (the expectAccessible fixture) and passes on all three engines, no retries.
function e2e(specs) {
  for (const spec of specs) {
    if (!exists(spec)) return `missing ${spec}`;
    if (!readText(spec).includes('expectAccessible(')) return `${spec} has no axe scan (expectAccessible)`;
  }
  return playwrightSpecs(specs, BROWSERS, { runner: imageRunner() });
}

// ── requirements and decisions ────────────────────────────────────────────────────────────────────
leg('M19 M/S requirements traced to tests', () => command('scripts/gates/check-trace.mjs', ['--milestone', 'M19', '--priority', 'M,S']));
for (const number of ['0052', '0053', '0054']) leg(`ADR-${number} accepted before feature contracts`, () => accepted(number));
leg('schema 1.8 minor: the 1.7 fixture migrates, validates and round-trips', () =>
  exists('packages/schema/src/__fixtures__/v1.8/document.flux.json')
    ? tests('packages/schema/src/migrate.test.ts', { named: '1.7→1.8' })
    : 'missing packages/schema/src/__fixtures__/v1.8/document.flux.json',
);

// ── features (plan tasks 3-17) ─────────────────────────────────────────────────────────────────────
// ADR-0052's Confirmation and its cp1 F1 amendment, each a named case (M19 cp1 F2)
leg('FR-ARR-006 frames carry children by the same delta and reparent on drop, undoably', () =>
  all(
    () =>
      tests('packages/core/src/commands/frames.test.ts', {
        named: [
          'a frame move carries its members by the same delta',
          'a frame resize leaves members unchanged',
          'flip carries members',
          'flipping a turned frame (φ) maps a member rot θ to 2φ − θ',
          'a drop into a live frame adopts the element as auto',
          'a hidden frame is never a drop target',
          'leaves the frame and joins the group',
          'random drags that reparent, each undone, restore the store exactly',
        ],
      }),
    () => tests('packages/layout/src/arrange.test.ts', { named: 'padding precedence layout.options.padding ?? frame.padding ?? default' }),
    () =>
      tests('packages/editor/src/select-tool.test.ts', {
        named: [
          'the resize handle on a selected frame leaves a member at its edge unchanged; a group resize still scales its member',
          'a group resize scales a frame inside it together with its own members',
          'a drag that drops a shape inside a frame reparents it',
          // the one turn path of a frame (M19 cp2 F1)
          'the rotate handle on a frame turns its members',
        ],
      }),
  ),
);
leg('FR-ARR-006 a clipping frame hides and does not hit or marquee an overflowing child', () =>
  all(
    () => tests('packages/editor/src/frame-hit.test.ts'),
    () => tests('packages/editor/src/overlay.browser.test.tsx', { project: 'browser', named: 'the frame a drag would drop into is outlined' }),
    () => tests('packages/render/src/frame-clip.browser.test.tsx', { project: 'browser' }),
  ),
);
leg('FR-ARR-007 match size per mode; the format painter copies style only', () =>
  all(
    () => tests('packages/core/src/commands/match-size.test.ts'),
    () => tests('packages/core/src/commands/format-painter.test.ts'),
  ),
);
leg('M8 handoff: align to a key object, distribute by centres and tidy to equal gaps from the arrange UI', () =>
  tests('packages/editor/src/arrange-panel.browser.test.tsx', { project: 'browser' }),
);
leg('FR-SHP-009 a flipped e anchor resolves to the west side and a bound connector follows', () =>
  all(
    () => tests('packages/geometry/src/flip-anchors.test.ts'),
    () => tests('packages/routing/src/flip-follow.test.ts'),
  ),
);
leg('FR-SHP-007 a card shape renders three editable text regions and an icon slot', () =>
  tests('packages/render/src/text-regions.browser.test.tsx', { project: 'browser' }),
);
leg('FR-SHP-010 boolean ops match their goldens (area within 0.5 % of reference)', () => tests('packages/geometry/src/boolean.test.ts'));
leg('FR-SHP-014 tables render merged cells and three theme table styles', () =>
  tests('packages/render/src/table-view.browser.test.tsx', { project: 'browser' }),
);
// ADR-0054's master outcomes, each a named case (M19.22 r1 F1)
leg('FR-SCR-005 a master change updates every dependent screen', () =>
  all(
    () =>
      tests('packages/core/src/masters.test.ts', {
        named: [
          'none for a non-master target, a chain, a size mismatch or an infinite screen, each with its problem',
          'a `fills` naming no placeholder of the applied master draws as an ordinary element',
          'a master change updates every dependent screen in the derived model',
        ],
      }),
    () =>
      tests('packages/render/src/master-view.browser.test.tsx', {
        project: 'browser',
        named: [
          'a placeholder never draws as an element; an unfilled one is a hint in edit mode only',
          'the screen’s own background wins; hideMasterElements keeps the background',
          'a master change updates every dependent screen',
          'a drag redraws the element and not the master',
          'present order and export skip it, the navigator lists it apart',
        ],
      }),
    () => tests('packages/editor/src/screens-tab.browser.test.tsx', { project: 'browser', named: 'master screens are listed in their own section' }),
  ),
);
const SPECS = ['layers.reorder', 'locks', 'text-regions.edit', 'path.edit-vertex', 'table.edit', 'masters.propagate', 'quick-connect', 'search.find-element'];
for (const spec of SPECS) leg(`${spec}: Chromium, Firefox, WebKit; axe clean; no retries`, () => e2e([`e2e/${spec}.spec.ts`]));
leg('FluxScript table, frame and master: examples/dsl/masters-tables.flux.yaml renders to its golden', () => {
  for (const file of ['examples/dsl/masters-tables.flux.yaml', 'examples/dsl/__golden__/masters-tables.svg']) if (!exists(file)) return `missing ${file}`;
  if (!readText('scripts/dsl/examples.test.ts').includes("matchesGolden('masters-tables')")) return 'masters-tables golden not exercised';
  return tests('scripts/dsl/examples.test.ts', { config: 'scripts/dsl/examples.config.ts' });
});

// ── parity, size, coverage ─────────────────────────────────────────────────────────────────────────
leg('edit/present parity within PARITY_MAX_DIFF_PCT includes masters, frames and tables', () => {
  const spec = 'e2e/parity.edit-vs-present.spec.ts';
  if (!/const EXAMPLES = \[[^\]]*'masters-tables'/.test(readText(spec))) return `${spec} does not compare the masters-tables example`;
  // the example must hold each feature the parity criterion names, a clipping frame included (plan review r1 F1)
  const example = 'examples/dsl/masters-tables.flux.yaml';
  if (!exists(example)) return `missing ${example}`;
  const source = readText(example);
  const lacking = [/^\s*master:/m, /\btable\b/, /\bframe\b/, /\bclip:\s*true\b/].filter((re) => !re.test(source));
  if (lacking.length) return `${example} lacks ${lacking.map(String).join(', ')}`;
  return playwrightSpecs([spec], BROWSERS, { runner: imageRunner() });
});
leg(`size-limit: editor initial ≤ EDITOR_INITIAL_GZIP (${t('EDITOR_INITIAL_GZIP')})`, () => {
  // size-limit exits 1 when any entry is over; this leg judges the editor entry, the verify leg the rest
  const r = run('pnpm', ['exec', 'size-limit', '--json']);
  let entries;
  try {
    entries = JSON.parse(r.stdout);
  } catch {
    return `size-limit printed no report: ${result(r)}`;
  }
  const editor = entries.find((e) => e.name === 'editor initial')?.size;
  if (editor === undefined) return 'size-limit lists no "editor initial" entry';
  return editor <= t('EDITOR_INITIAL_GZIP') || `editor initial ${editor} B > ${t('EDITOR_INITIAL_GZIP')}`;
});
leg('packages/geometry coverage at or above COVERAGE_PURE_LINES/BRANCHES', () => {
  const out = mkdtempSync(join(tmpdir(), 'm19-cov-'));
  try {
    const report = join(out, 'report.json');
    const r = run('pnpm', [
      'exec',
      'vitest',
      'run',
      '--project',
      'node*',
      '--coverage',
      '--coverage.reporter=json-summary',
      '--coverage.include=packages/geometry/src/**',
      `--coverage.reportsDirectory=${out}`,
      '--reporter=json',
      `--outputFile=${report}`,
      'packages/geometry',
    ]);
    // the configured per-glob thresholds fail packages this run does not cover, so the exit status is not
    // the judge: the report (every test passed) and the summary against the floors are (as m12-complete)
    if (!existsSync(report)) return `vitest wrote no report: ${result(r)}`;
    const { numFailedTests, numPassedTests } = JSON.parse(readFileSync(report, 'utf8'));
    if (numFailedTests > 0 || numPassedTests === 0) return `packages/geometry: ${failedTest(report) ?? `${numFailedTests} failed, ${numPassedTests} passed`}`;
    const summary = join(out, 'coverage-summary.json');
    return existsSync(summary)
      ? coverageGaps(
          JSON.parse(readFileSync(summary, 'utf8')),
          'packages/geometry',
          { lines: t('COVERAGE_PURE_LINES'), branches: t('COVERAGE_PURE_BRANCHES') },
          300,
        )
      : `no coverage summary: ${result(r)}`;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ── handed-off harness rows (M18) ──────────────────────────────────────────────────────────────────
leg('milestone-gate keeps gate.log out of the workspace and prints precommit failure detail', () =>
  all(
    () => namedCases('tests/harness/ci-workflow.test.mjs', ['gate log outside the workspace']),
    () => namedCases('tests/harness/verify-leg.test.mjs', ['precommit failure detail']),
  ),
);
leg('last-ci tests read node:test output on Node 22 and Node 24', () => namedCases('tests/harness/last-ci.test.mjs', ['any Node major']));
leg('changesets count every path a published workspace ships (M18 cp45 F5)', () =>
  namedCases('tests/harness/milestone-checks.test.mjs', ['pack-only change is a gap', 'grammar change is a gap', 'test file under src is none']),
);
leg('decodePng pinned by a unit test over all five row filters, and one CI run checks it against the browser (M18 cp51 F4)', () =>
  all(
    () => tests('e2e/pages/image-diff.test.ts'),
    () =>
      readdirSync(repoPath('.github/workflows')).some((f) => /FLUXION_PNG_CHECK:\s*['"]?1/.test(readText(`.github/workflows/${f}`))) ||
      'no workflow runs the pixel specs with FLUXION_PNG_CHECK=1',
  ),
);
// M19.28's target: the recorded cold setup is a CI reading at or under 420 s (477 s at M18's close; plan review r1 F3)
leg('cold setup recorded from CI at or under 420 s (M19.28)', () => {
  const budget = json('.harness/budget.json');
  if (!String(budget.coldSetupSource ?? '').startsWith('ci:')) return `cold setup source ${budget.coldSetupSource} is not a CI reading`;
  return budget.coldSetupMs <= 420_000 || `cold setup ${budget.coldSetupMs} ms > 420000`;
});
leg('one hand-off spelling; a hand-off target without its row is refused (M18 final F2)', () =>
  namedCases('tests/harness/milestone-checks.test.mjs', ['hand-off without a target row is refused']),
);

// ── closeout ───────────────────────────────────────────────────────────────────────────────────────
leg(
  'no open M19 spec folders',
  () => readdirSync(repoPath('specs')).every((name) => !/^M19(?:[.-]|$)/.test(name)) || 'archive completed M19 specs into living docs',
);
leg('no open test quarantines', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout.split(/\r?\n/).filter((line) => line && !line.includes('tests/harness/'));
  return hits.length === 0 || hits.slice(0, 3).join(' | ');
});
leg('changesets cover changed packages', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M19\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M19 commits yet';
});
leg('full verification with all required steps', () =>
  verifyLeg([
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
  ]),
);
leg('three-OS CI and nightly perf cover final review range', () => command('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M19', '--perf']));
leg('all M19 backlog rows done including review findings', () => checkBacklogDone(backlogTextFor('M19'), 'M19', loadMilestoneReviews('M19')));
leg('independent final review covers M19', () =>
  exists('.harness/reviews/milestone-M19-final.json') ? checkFinalReview(json('.harness/reviews/milestone-M19-final.json'), 'M19') : 'missing M19 final review',
);
leg('roadmap advanced past M19', () => Number(currentMilestone()?.slice(1)) > 19 || `current milestone ${currentMilestone()}`);
await runLegs('m19');
