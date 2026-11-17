#!/usr/bin/env node
// M20's executable exit criteria (docs/milestones/M20.md), the R3 increment exit. Missing future files fail; existence alone
// never proves a feature. The row that writes a test keeps its leg's file name or renames it here in the same commit.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSource } from './ci-runs.mjs';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  changesetsCoverRange,
  checkAdrBeforeRows,
  checkBacklogDone,
  checkColdMedian,
  checkExitChecklist,
  checkFinalReview,
  ciColdReadings,
  imageRunner,
  loadMilestoneReviews,
  missingNamedCases,
  sharedPlaywright,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const result = (r) => r.status === 0 || (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-4).join(' | ') || `exit ${r.status}`;
const command = (file, args = []) => (exists(file) ? result(node(file, args)) : `missing ${file}`);
const json = (file) => JSON.parse(readText(file));
const BROWSERS = ['chromium', 'firefox', 'webkit'];
/** M20's plan commit (M20.1): the cold-setup leg counts ci runs from here. */
const M20_FIRST_COMMIT = '66b5a51';

// The first failing test's full name and first failure line from a Vitest JSON report (as m19-complete).
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

// A nonempty report, a successful process and every assertion passed; with `named`, a passed case whose own title is exactly each
// text, so the leg judges the cases it names (M18.244, cp36 F3); exact, not a substring of a longer title (M20.27, cp1 F2).
function tests(file, { project = 'node*', config, named = [] } = {}) {
  if (!exists(file)) return `missing ${file}`;
  const dir = mkdtempSync(join(tmpdir(), 'm20-tests-'));
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
    const missing = missingNamedCases(assertions, named);
    return missing.length === 0 || `${file}: no passed case named ${missing.map((n) => `'${n}'`).join(', ')}`;
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
// Accepted, and committed before every feature row it governs (checkAdrBeforeRows: each filled Commit cell descends from the
// commit that added the ADR; an empty cell is check-digest's to hold).
function accepted(number, rows) {
  const name = readdirSync(repoPath('docs/architecture/decisions')).find((n) => n.startsWith(`ADR-${number}-`));
  if (!name) return `missing ADR-${number}`;
  const file = `docs/architecture/decisions/${name}`;
  if (!/^status: accepted\b/m.test(readText(file))) return `ADR-${number} not accepted`;
  const added = run('git', ['log', '--diff-filter=A', '--format=%H', '--', file]).stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return checkAdrBeforeRows(readText('docs/backlog/current.md'), rows, { number, added });
}
// every browser leg's specs in one Playwright run, one build (M19.58); each leg is still judged on its own specs (plan review r1 F3)
const browsers = sharedPlaywright(
  ['e2e/theme.editor-live.spec.ts', 'e2e/export.svg-parity.spec.ts', 'e2e/export.svg.spec.ts', 'e2e/studio.boot-phases.spec.ts'],
  BROWSERS,
  { runner: imageRunner },
);
// Each named e2e spec scans with axe (the expectAccessible fixture) and passes on all three engines, no retries.
function e2e(specs) {
  for (const spec of specs) {
    if (!exists(spec)) return `missing ${spec}`;
    if (!readText(spec).includes('expectAccessible(')) return `${spec} has no axe scan (expectAccessible)`;
  }
  return browsers(specs);
}

// ── requirements and decisions ────────────────────────────────────────────────────────────────────
leg('M20 M/S requirements traced to tests', () => command('scripts/gates/check-trace.mjs', ['--milestone', 'M20', '--priority', 'M,S']));
leg('check-trace --increment R3: every Must requirement of R3 has a test naming it', () => command('scripts/gates/check-trace.mjs', ['--increment', 'R3']));
const rowsOf = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `M20.${from + i}`);
for (const [number, what, rows] of [
  ['0055', 'palette generation and DTCG mapping', rowsOf(5, 11)],
  ['0056', 'SVG export strategy', rowsOf(12, 15)],
  ['0057', 'decompiler canonical form', rowsOf(16, 18)],
])
  leg(`ADR-${number} (${what}) accepted before its feature rows (${rows[0]}-${rows.at(-1)})`, () => accepted(number, rows));

// ── theme studio (plan tasks 3-9) ──────────────────────────────────────────────────────────────────
leg('FR-THM-005 every generated text/background pair from 1-3 seeds is at least 4.5:1 (property)', () =>
  tests('packages/theme/src/palette.prop.test.ts', {
    named: ['FR-THM-005: every text/background pair from 1-3 seeds is at least 4.5:1', 'FR-THM-005: a locked role keeps its colour through shuffle'],
  }),
);
leg('FR-THM-005 a fixture image gives the same palette twice and its AA pairs hold', () =>
  tests('packages/theme/src/palette-image.test.ts', {
    named: ['FR-THM-005: a fixture image gives the same palette twice', 'FR-THM-005: an image palette holds its AA pairs'],
  }),
);
leg('FR-THM-006 per-kind default styles and variants resolve by reference; variant emphasis renders themed', () =>
  all(
    () =>
      tests('packages/theme/src/variants.test.ts', {
        named: ['FR-THM-006: a variant reference resolves by kind', 'FR-THM-006: a shape definition default applies to its shapes'],
      }),
    () =>
      tests('packages/render/src/variant-style.browser.test.tsx', {
        project: 'browser',
        named: ['FR-THM-006: variant emphasis renders the themed style', 'FR-THM-006: a theme edit restyles a variant element with no element change'],
      }),
    // the tone written by AI reaches the view (cp2 F4)
    () =>
      tests('packages/editor/src/variant-tone.browser.test.tsx', {
        project: 'browser',
        named: [
          'FR-THM-006: variant emphasis set through FluxScript renders the themed style',
          'FR-THM-006: variant emphasis set through a patch renders the themed style',
        ],
      }),
  ),
);
leg('FR-THM-007 an exported theme file re-imports deep-equal; a theme pack registers its themes and they appear in the theme picker', () =>
  all(
    () =>
      tests('packages/theme/src/theme-file.test.ts', {
        named: ['FR-THM-007: an exported theme file re-imports deep-equal', 'FR-THM-007: a theme pack registers its themes'],
      }),
    () => tests('packages/editor/src/theme-picker.browser.test.tsx', { project: 'browser', named: ['FR-THM-007: pack themes appear in the theme picker'] }),
  ),
);
leg('FR-THM-009 the DTCG fixture round-trips equal and the CSS-variable export matches its golden', () =>
  all(
    () => exists('packages/theme/src/__golden__/theme.css') || 'missing packages/theme/src/__golden__/theme.css',
    () =>
      tests('packages/theme/src/dtcg.test.ts', {
        named: [
          'FR-THM-009: the canonical DTCG fixture round-trips equal',
          'FR-THM-009: a foreign ramp file imports with warnings and never fails',
          'FR-THM-009: the CSS-variable export matches its golden',
        ],
      }),
  ),
);
leg('NFR-A11Y-005 the contrast linter flags each combo below WCAG AA and the validation panel offers its fix', () =>
  all(
    () =>
      tests('packages/theme/src/contrast-lint.test.ts', {
        named: [
          'NFR-A11Y-005: text below 4.5:1 is flagged',
          'NFR-A11Y-005: large text below 3:1 is flagged',
          'NFR-A11Y-005: a stroke below 3:1 is flagged',
          'NFR-A11Y-005: a combination at AA is not flagged',
        ],
      }),
    () =>
      tests('packages/editor/src/validation-contrast.browser.test.tsx', {
        project: 'browser',
        named: ['NFR-A11Y-005: the validation panel offers the contrast fix', 'NFR-A11Y-005: applying the fix clears the warning'],
      }),
  ),
);
leg('theme.editor-live: changing primary recolours the canvas within one frame; Chromium, Firefox, WebKit; axe clean', () =>
  e2e(['e2e/theme.editor-live.spec.ts']),
);

// ── SVG export (plan tasks 10-12) ──────────────────────────────────────────────────────────────────
leg('FR-EXP-004 an exported fixture is standalone SVG 1.1: text as measured tspans, no foreignObject, package in metadata', () =>
  tests('packages/exporters/src/svg.test.ts', {
    named: [
      'FR-EXP-004: an exported fixture is valid SVG 1.1',
      'FR-EXP-004: text is measured tspans with no foreignObject',
      'FR-EXP-004: the package is in metadata',
    ],
  }),
);
leg(`FR-EXP-004 rasterized SVG vs present mode within PARITY_MAX_DIFF_PCT (${t('PARITY_MAX_DIFF_PCT')} %) in three browsers`, () =>
  browsers(['e2e/export.svg-parity.spec.ts']),
);
leg('export.svg: the studio downloads an SVG of the screen and of a selection; Chromium, Firefox, WebKit; axe clean', () => e2e(['e2e/export.svg.spec.ts']));
leg('FR-CLI-002 fluxion render --format svg writes one SVG per screen', () =>
  tests('packages/cli/src/e2e/render-svg.test.ts', { named: ['FR-CLI-002: render --format svg writes one SVG per screen'] }),
);
leg('FR-EXP-004 a recorded green nightly opens the exported fixtures in Inkscape (CLI export succeeds)', () =>
  command('scripts/gates/check-inkscape-evidence.mjs'),
);

// ── decompiler v1 (plan tasks 13-14, M19 hand-off row 19) ──────────────────────────────────────────
leg('FR-DSL-008 compile(decompile(doc)) is doc over the fixture corpus and generated documents (property)', () =>
  tests('packages/dsl/src/decompile/decompile.prop.test.ts', {
    named: [
      'FR-DSL-008: compile(decompile(doc)) is doc over the fixture corpus',
      'FR-DSL-008: compile(decompile(doc)) is doc over generated documents',
      // ADR-0057's I2 contract (M20.4 review r1)
      'FR-DSL-008: decompile(compile(src)) is a fixpoint',
      // raw records bounded, so a broken key emitter cannot hide in raw: (M20.4 review r1 F1, F2)
      'FR-DSL-008: compiled documents decompile with no raw records',
      'FR-DSL-008: key-expressible generated documents decompile with no raw records',
    ],
  }),
);
leg('FR-DSL-008 the decompiler writes raw: escape blocks for inexpressible records and its outline is no larger than v0', () =>
  tests('packages/dsl/src/decompile/decompile.test.ts', {
    named: [
      'raw: escape block',
      'outline tokens not worse than v0',
      'FR-DSL-008: examples decompile with no raw records',
      'FR-DSL-008: normalize is idempotent and adds only defaults',
      'FR-DSL-008: an editor-built document decompiles with no raw records and keeps its ids',
      'FR-DSL-008: a studio-made document compiles back in restore mode',
      "FR-DSL-008: an editor-built document's token ratio to canonical JSON does not fall below its recorded baseline",
    ],
  }),
);
leg('M19 hand-off: hideMasterElements, region texts and icon slots round-trip in FluxScript; patch ops edit masters, placeholders, tables and frames', () =>
  all(
    () =>
      tests('packages/dsl/src/decompile/decompile.test.ts', { named: ['hideMasterElements round-trips', 'region texts round-trip', 'icon slots round-trip'] }),
    () => tests('packages/dsl/src/patch/apply.test.ts', { named: ['patch masters', 'patch placeholders', 'patch tables', 'patch frames'] }),
  ),
);
// M20.18: each consumer of the decompiler is on v1 (M20.27, cp1 F2)
leg('FR-DSL-008 fluxion decompile, MCP get_screen and the Source view use decompiler v1', () =>
  all(
    () => tests('packages/cli/src/e2e/decompile-v1.test.ts', { named: ['FR-DSL-008: fluxion decompile writes decompiler v1 source'] }),
    () => tests('packages/mcp/src/get-screen-v1.test.ts', { named: ['FR-DSL-008: get_screen returns decompiler v1 source'] }),
    () =>
      tests('packages/editor/src/source-view/source-v1.browser.test.tsx', {
        project: 'browser',
        named: ['FR-DSL-008: the Source view shows decompiler v1 source'],
      }),
  ),
);

// ── mutation floors and the route-drag check (plan tasks 15, 15a) ───────────────────────────────────
leg(`NFR-MNT-005 schema, layout and routing have mutation floors at least MUTATION_PURE_SCORE (${t('MUTATION_PURE_SCORE')} %) next to core's`, () => {
  const { packages = {} } = json('.harness/baselines/mutation.json');
  const low = ['packages/schema', 'packages/layout', 'packages/routing', 'packages/core'].filter(
    (dir) => !(Number(packages[dir]?.score) >= t('MUTATION_PURE_SCORE')),
  );
  return low.length === 0 || `no floor at or above ${t('MUTATION_PURE_SCORE')} % for ${low.join(', ')}`;
});
leg('NFR-MNT-005 complete current-revision mutation reports meet every floor', () =>
  command('scripts/gates/check-mutation-evidence.mjs', ['--milestone', 'M20']),
);
leg('FR-RTE-002 perf.route-drag-200 passes on three consecutive nightlies after its decision, without retries (M17.43 hand-off)', () =>
  command('scripts/gates/check-route-drag-evidence.mjs'),
);

// ── R3 demo and exit (plan tasks 16-17) ────────────────────────────────────────────────────────────
leg('R3 demo: examples/r3-architecture has 60 nodes, 0 overlaps, every connector orthogonal and obstacle-free, its golden and an SVG export', () => {
  for (const file of ['examples/r3-architecture.flux.yaml', 'examples/r3-architecture.flux.html']) if (!exists(file)) return `missing ${file}`;
  // plan review r1 F4: obstacle-free connectors and the golden are named cases too
  return tests('scripts/examples/r3-demo.test.ts', { named: ['60 nodes', 'no overlap', 'orthogonal', 'obstacle-free', 'golden', 'svg export'] });
});
leg('the R3 exit checklist covers M16-M20 with evidence, every box ticked', () => {
  if (!exists('docs/milestones/exits/R3.md')) return 'missing docs/milestones/exits/R3.md';
  const text = readText('docs/milestones/exits/R3.md');
  // M16's rows 1-11 stay; M20 adds the rows for M17-M20 and the increment-wide criteria (01-scope §2)
  return checkExitChecklist(text, { from: 1, to: 99, min: 18, resolves: (href) => exists(join('docs/milestones/exits', href)) });
});

// ── M19 hand-off: the editor first-screen stall (row 20) ───────────────────────────────────────────
leg('studio boot phases are reported when the editor does not open; Chromium, Firefox, WebKit', () => browsers(['e2e/studio.boot-phases.spec.ts']));
// plan review r1 F2: the row closes on its fix or on recorded no-recurrence runs, not on the M19.29 spec alone
leg('the editor first-screen stall is fixed or has not recurred in three recorded three-engine e2e runs at distinct M20 shas', () =>
  exists('scripts/gates/check-editor-stall-evidence.mjs')
    ? command('scripts/gates/check-editor-stall-evidence.mjs')
    : 'missing scripts/gates/check-editor-stall-evidence.mjs',
);

// ── docs (row 24, plan review r1 F5) ───────────────────────────────────────────────────────────────
leg('docs: theme studio and SVG export guides exist and examples/README.md lists the R3 demo', () => {
  for (const file of ['apps/docs/src/content/docs/guides/theme-studio.md', 'apps/docs/src/content/docs/guides/svg-export.md'])
    if (!exists(file)) return `missing ${file}`;
  return readText('examples/README.md').includes('r3-architecture') || 'examples/README.md does not list r3-architecture';
});

// ── closeout ───────────────────────────────────────────────────────────────────────────────────────
leg(
  'no open M20 spec folders',
  () => readdirSync(repoPath('specs')).every((name) => !/^M20(?:[.-]|$)/.test(name)) || 'archive completed M20 specs into living docs',
);
leg('no open test quarantines', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout.split(/\r?\n/).filter((line) => line && !line.includes('tests/harness/'));
  return hits.length === 0 || hits.slice(0, 3).join(' | ');
});
leg('changesets cover changed packages', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M20\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M20 commits yet';
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
// M20.28 (cp1 F3, cp2 F1): every completed main ci run since M20's first commit, read from GitHub, not readings a driver chose
leg('CI cold setup median at most 420 s over every M20 main ci run', async () => checkColdMedian(await ciColdReadings(runSource(), M20_FIRST_COMMIT), 420_000));
leg('three-OS CI and nightly perf cover final review range', () => command('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M20', '--perf']));
leg('all M20 backlog rows done including review findings', () => checkBacklogDone(backlogTextFor('M20'), 'M20', loadMilestoneReviews('M20')));
leg('independent final review covers M20', () =>
  exists('.harness/reviews/milestone-M20-final.json') ? checkFinalReview(json('.harness/reviews/milestone-M20-final.json'), 'M20') : 'missing M20 final review',
);
leg('roadmap advanced past M20', () => Number(currentMilestone()?.slice(1)) > 20 || `current milestone ${currentMilestone()}`);
await runLegs('m20');
