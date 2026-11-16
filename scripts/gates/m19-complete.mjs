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
  checkColdReadings,
  checkFinalReview,
  checkPngEvidence,
  coverageGaps,
  imageRunner,
  loadMilestoneReviews,
  namedCases,
  sharedPlaywright,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const result = (r) => r.status === 0 || (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-4).join(' | ') || `exit ${r.status}`;
const command = (file, args = []) => (exists(file) ? result(node(file, args)) : `missing ${file}`);
const json = (file) => JSON.parse(readText(file));
const PNG_EVIDENCE = '.harness/reviews/png-check-evidence.json';
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
  return browsers(specs);
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
    () =>
      tests('packages/editor/src/frame-hit.test.ts', {
        named: [
          'a member overflowing a clipping frame is hit inside the frame only',
          'a marquee touches or contains a clipped member by what the frame shows of it',
          'the clip follows the frame: moved, turned, or inside another clipping frame',
        ],
      }),
    () => tests('packages/editor/src/overlay.browser.test.tsx', { project: 'browser', named: 'the frame a drag would drop into is outlined' }),
    () => tests('packages/render/src/frame-clip.browser.test.tsx', { project: 'browser' }),
  ),
);
leg('FR-ARR-007 match size per mode; the format painter copies style only', () =>
  all(
    // each a named case (M19 cp3 F5, M19.42)
    () =>
      tests('packages/core/src/commands/match-size.test.ts', {
        named: [
          "width, height and both give each element the key's dimension",
          'a group scales its members',
          'a turned member of a group stretches along its own axes',
          'a listed group that holds the key is left out',
          'nothing left to size is refused',
        ],
      }),
    () =>
      tests('packages/core/src/commands/format-painter.test.ts', {
        named: [
          'the format painter copies style with its tokens and never semantic',
          "painting from an unstyled element clears the target's style",
          'a group as the source is refused',
        ],
      }),
    // the editor's Copy style and Paste style (M19.40, M19 cp7 F1)
    () =>
      tests('packages/editor/src/style-paint.test.ts', {
        named: [
          'Paste style gives every selected element the copied style, tokens as written, in one undo step',
          'Copy style needs exactly one element; Paste style needs a copied style and another element',
          'the element menu offers Copy style for one element and Paste style once a style is copied',
        ],
      }),
  ),
);
leg('M8 handoff: align to a key object, distribute by centres and tidy to equal gaps from the arrange UI', () =>
  tests('packages/editor/src/arrange-panel.browser.test.tsx', {
    project: 'browser',
    named: ['picking a key object aligns the others to it, the key staying', 'distribute by centres spaces the centres evenly'],
  }),
);
leg('FR-SHP-009 a flipped e anchor resolves to the west side and a bound connector follows', () =>
  all(
    () => tests('packages/geometry/src/flip-anchors.test.ts'),
    () => tests('packages/routing/src/flip-follow.test.ts'),
  ),
);
leg('FR-SHP-007 a card shape renders three editable text regions and an icon slot', () =>
  all(
    () =>
      tests('packages/render/src/text-regions.browser.test.tsx', {
        project: 'browser',
        named: ['a card shape renders three editable text regions and an icon slot', 'a texts key naming the first region is not drawn'],
      }),
    () => tests('packages/editor/src/text-regions.test.ts', { named: 'a texts entry naming the first region is reported' }),
    // icon slots load the pack definitions they name and the save embeds them (M19.38, M19 cp7 F1)
    () =>
      tests('packages/editor/src/slot-section.browser.test.tsx', {
        project: 'browser',
        named: [
          'a slot naming a catalog definition loads and registers it before the slot is filled',
          'a slow load does not overwrite a later commit of the same slot',
          'a slow load on one shape still fills it after a commit to the same slot of another shape',
        ],
      }),
    () => tests('packages/format/src/shape-pack-prepare.test.ts', { named: 'a definition an icon slot names is embedded with the shapes' }),
    () => tests('apps/studio/src/pack-catalog.slots.test.ts', { named: 'loads it and the save embeds it' }),
  ),
);
// the lock cases by name, core's arranging commands and the editor's tools (M19 cp2 F5, M19.42)
leg('FR-SHP-008 locks stop drags, nudges, handles, arranging, the painter and path edits', () =>
  all(
    () =>
      tests('packages/core/src/arrange/locks.test.ts', {
        named: [
          'align leaves a position-locked element where it is',
          'distribute leaves a position-locked element in place',
          'match size skips a size-locked element and keeps the ratio of an aspect-locked one',
          'the format painter skips an edit-locked element',
          'a flip reads no lock',
          'hasLock reads one element; lockedWithin also reads the groups it sits in',
        ],
      }),
    () =>
      tests('packages/editor/src/locks-tool.test.ts', {
        named: [
          'a position-locked element does not move by drag or arrow nudge',
          'a rotation lock keeps the turn; a size lock keeps the size; an aspect lock keeps the ratio',
          'a selection-locked element is not picked by a click, a marquee or select-all',
          'a locked element neither snaps with a drag of the others nor stops its own resize',
          'a handle gesture on several elements leaves a position-locked one where it is',
        ],
      }),
    () => tests('packages/editor/src/path-edit.test.ts', { named: 'a path locked against edit, size or position is not reshaped' }),
  ),
);
leg('FR-SHP-010 boolean ops match their goldens (area within 0.5 % of reference)', () =>
  all(
    () =>
      tests('packages/geometry/src/boolean.test.ts', {
        named: [
          'every golden case gives its committed bytes',
          'a star and a rounded rectangle combine within 0.5 % of their reference areas',
          'the same operands give the same bytes',
        ],
      }),
    () =>
      tests('packages/core/src/shape/boolean-command.test.ts', {
        named: [
          'the operands become one path shape in their place',
          // a bound connector keeps its segment-bound place only where it still lies on the result
          'a connector keeps its place where that place still lies on the result outline',
          'refuses fewer than two shapes',
        ],
      }),
  ),
);
// the browsers give Node's golden bytes (M19 cp4 F1): a computation spec that opens no editor page to scan; the context-menu
// Union (arrange.boolean) is in SPECS, with axe
leg('FR-SHP-010 boolean goldens in the browsers: Chromium, Firefox, WebKit; no retries', () => browsers(['e2e/geometry.boolean-engines.spec.ts']));
// core:path draws, hits and reports its own path, and a path on another definition is ignored (M19.41, M19 cp4 F1)
leg('core:path: the path shape is drawn and hit by its own path; a path on another definition is ignored', () =>
  all(
    () =>
      tests('packages/core/src/shape/path-shape.test.ts', {
        named: ['scales d from its w × h box to the element box', 'only a core:path element draws its path: on another definition it is ignored'],
      }),
    () => tests('packages/editor/src/path-shape.test.ts', { named: 'a path on another definition is ignored' }),
    () =>
      tests('packages/render/src/path-shape.browser.test.tsx', {
        project: 'browser',
        named: ['draws its own path scaled from w × h to its box', 'a path on another definition is ignored'],
      }),
  ),
);
leg('FR-SHP-014 tables render merged cells and three theme table styles', () =>
  all(
    () =>
      tests('packages/render/src/table-view.browser.test.tsx', {
        project: 'browser',
        named: [
          'merged cells span theirs and the cells they cover are not drawn',
          'the built-in plain, banded and grid table styles draw to their goldens',
          'a cell’s style wins over its table-style part, which wins over the theme',
        ],
      }),
    () => tests('packages/render/src/table-layout.test.ts', { named: 'a span reaching past the grid is cut at its edge' }),
    // editing: cell text opens in place, not on a locked table; each line lands where it says (M19.43, cp4 F6, M19 cp7 F1)
    () =>
      tests('packages/editor/src/table-edit.test.ts', {
        named: [
          'a double-click on a cell, or Enter with one picked, opens that cell',
          'a covered cell or a locked table opens none',
          'each row and column line beside the picked cell lands where it says',
        ],
      }),
  ),
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
    // the master editing commands and UI (M19.23)
    () =>
      tests('packages/core/src/screens/master-commands.test.ts', {
        named: [
          'refuses a screen with a master or an infinite one',
          'a master leaves its screens without a master and clears their fills',
          'gives a screen the master and its size',
          'clears its own fills only',
          'unnaming clears its fillers',
          'puts a copy of the placeholder on the screen, on top, filling it',
          'presentation order skips a master',
          'element.setPlaceholder refuses a group',
          'element.fillPlaceholder refuses a group placeholder that came in another way',
        ],
      }),
    () =>
      tests('packages/editor/src/master-edit.test.ts', {
        named: [
          'becomes a placeholder named by its name',
          'a double-click inside an unfilled placeholder hint fills it',
          'Edit master shows the shown screen’s master',
          'Close master shows the screen Edit master was run from',
          'Close master falls back to the first screen in navigator order using the master',
          'a group named a placeholder in a loaded file shows no fill hint',
          'a canvas menu offers each master line only where it acts',
        ],
      }),
    () => tests('packages/editor/src/navigator/master-menu.test.ts', { named: 'each line runs one master command on the screen' }),
    () =>
      tests('packages/editor/src/present.browser.test.tsx', {
        project: 'browser',
        named: ['while a master is shown starts at the first slide', 'a document whose every screen is a master presents nothing'],
      }),
    () => tests('packages/cli/src/ops/outline.test.ts', { named: 'the outline lists the slides and not their master' }),
    () => tests('apps/studio/src/library/thumbnail.test.ts', { named: 'a master is not the thumbnail' }),
  ),
);
// quick-connect's outcomes, each a named case (M19.24)
leg('FR-EDT-015 quick-connect joins a shape to another or to a new one from the mini library', () =>
  tests('packages/editor/src/quick-connect.test.ts', {
    named: [
      'a hovered shape has a "+" beyond the middle of each side; a selected one has none',
      'dragged onto another shape joins the two with a bound connector in one undo step',
      'Same shape adds the source’s shape beyond the drop, joined, one undo step',
      'Connector only leaves the end free at the drop',
      'a press on a nearby selected shape’s handle resizes it',
      'a click on a "+" without a drag goes back to idle and opens nothing',
      'a drag dropped back on its own shape adds nothing and opens nothing',
      'a "+" lying over a nearby shape stays the hovered shape’s',
    ],
  }),
);
// element search's outcomes, each a named case (M19.25)
leg('FR-EDT-016 element search finds by text, name and semantic label and jumps across screens', () =>
  tests('packages/editor/src/find-model.test.ts', {
    named: [
      'FR-EDT-016: a query finds elements by text, name and semantic label, ignoring case, screen by screen in reading order',
      'FR-EDT-016: text regions and table cells are searched too',
      'FR-EDT-016: Enter jumps to the next match across screens and selects it',
    ],
  }),
);
const SPECS = [
  'layers.reorder',
  'locks',
  'text-regions.edit',
  'path.edit-vertex',
  'table.edit',
  'masters.propagate',
  'quick-connect',
  'search.find-element',
  // M19 cp7 F1: the format painter UI, cell text and icon-slot packs
  'style-paint',
  'table.cell-text',
  'library.icon-slot-pack',
  // M19 cp4 F1: Union from the context menu
  'arrange.boolean',
];
// every browser leg's specs in one Playwright run, one build (M19.58); each leg is still judged on its own specs
const browsers = sharedPlaywright(
  [...SPECS.map((spec) => `e2e/${spec}.spec.ts`), 'e2e/geometry.boolean-engines.spec.ts', 'e2e/parity.edit-vs-present.spec.ts'],
  BROWSERS,
  { runner: imageRunner },
);
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
  return browsers([spec]);
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
leg(
  'decodePng pinned by a unit test over all five row filters, and a recorded green nightly png-check checks it against the browser (M18 cp51 F4, M19.52)',
  () =>
    all(
      () => tests('e2e/pages/image-diff.test.ts'),
      () => checkPngEvidence(exists(PNG_EVIDENCE) ? json(PNG_EVIDENCE) : undefined),
    ),
);
// M19.28's target: three CI cold-setup readings at or after the row's commit, their median at or under 420 s (477 s at M18's close;
// plan review r1 F3; cp4 F2: one reading proves nothing)
leg('cold setup: 3 CI readings after M19.28, median at or under 420 s (M19.28)', () => {
  const budget = json('.harness/budget.json');
  // the row's own commit: the oldest whose subject (not a body line) names it, so a later "M19.28: …" bookkeeping commit cannot move it
  const from = run('git', ['log', '--reverse', '--format=%H%x09%s', '--grep=^M19\\.28: ', 'HEAD'])
    .stdout.split(/\r?\n/)
    .find((line) => line.split('\t')[1]?.startsWith('M19.28: '))
    ?.split('\t')[0];
  return all(
    () => checkColdReadings(budget.coldReadings, from),
    () => namedCases('tests/harness/budget.test.mjs', ['M19.28: --cold-from-ci keeps one reading per commit of the lockfile']),
    () => namedCases('tests/harness/milestone-checks.test.mjs', ['M19.28: the cold-setup leg counts 3 readings after the row, by their median']),
  );
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
