#!/usr/bin/env node
// M18's executable exit criteria. Missing future files fail; existence alone never proves a feature.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  benchUnder,
  changesetsCoverRange,
  checkBacklogDone,
  checkFinalReview,
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

// The first failing test's full name and first failure line from a Vitest JSON report, read before it
// is deleted; null when there is no readable report or no failed test in it (M18.166, cp22 F3).
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

// A nonempty report, successful process, and every assertion passed are all required.
function tests(file, { project = 'node', config } = {}) {
  if (!exists(file)) return `missing ${file}`;
  const dir = mkdtempSync(join(tmpdir(), 'm18-tests-'));
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
    return (
      (report.numFailedTestSuites === 0 && assertions.length > 0 && assertions.every((a) => a.status === 'passed')) ||
      `${file}: empty, failed, skipped or todo tests`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function accepted(number) {
  const file = readdirSync(repoPath('docs/architecture/decisions')).find((name) => name.startsWith(`ADR-${number}-`));
  return file ? /^status: accepted\b/m.test(readText(`docs/architecture/decisions/${file}`)) || `ADR-${number} not accepted` : `missing ADR-${number}`;
}

leg('M18 M/S requirements traced to tests', () => command('scripts/gates/check-trace.mjs', ['--milestone', 'M18', '--priority', 'M,S']));
for (const number of ['0048', '0049', '0050', '0051', '0171']) leg(`ADR-${number} accepted before feature contracts`, () => accepted(number));
for (const [name, expected] of [
  ['FONT_SUBSET_LATIN_MAX_BYTES', 60_000],
  ['DRAWIO_LIB_IMPORT_MIN_PCT', 90],
  ['SVG_IMPORT_MIN_ANCHORS', 4],
])
  leg(`${name} equals required ${expected}`, () => t(name) === expected || `${name} differs from requirement`);

// Earlier-milestone handoffs retain explicit executable checks.
leg('every M18 task commit keeps tracked review evidence and its Commit cell', () => command('scripts/gates/check-digest.mjs', ['--head', '--full-history']));
leg('review binding survives rebases and digest coverage refuses missing evidence', () =>
  namedCases('tests/harness/digest.test.mjs', [
    'before adoption, a task commit needs a tracked pass line for its task or a reviewed exemption',
    'after adoption, each task commit carries a pass line bound to its own content',
    'a done row needs its Commit cell once a later commit exists',
  ]),
);
leg('rebased commits land only through the gates, bound to their reviewed content', () =>
  namedCases('tests/harness/land.test.mjs', [
    're-gates a reviewed commit on the moved remote branch and pushes it',
    'refuses an unreviewed commit, leaving the branch where it started and the remote untouched',
    'refuses a commit whose re-applied diff no longer matches the review',
    'stops on a conflict and restores the branch',
  ]),
);
leg('checkpoint cadence refuses absent/stale reviews and accepts covering reviews', () =>
  namedCases('tests/harness/checkpoint.test.mjs', [
    'refuses a task after the checkpoint limit',
    'stale checkpoint does not clear the limit',
    'covering checkpoint clears the limit',
  ]),
);
leg('calibration judge rejects first-sample and varied-p99 mutants', () =>
  namedCases('tests/harness/perf-baseline.test.mjs', ['first sample is an outlier', 'varied p99 samples use the median']),
);
leg('retained millisecond baselines have real gate readers', () =>
  namedCases('tests/harness/perf-baseline.test.mjs', ['every retained millisecond baseline has a gate reader']),
);
for (const name of ['force', 'packing', 'timeline', 'swimlane'])
  leg(`${name}-500 within LAYOUT_500_NODES_MS`, () => benchUnder(`packages/layout/bench/${name}-500.bench.ts`, `${name}-500`, t('LAYOUT_500_NODES_MS')));
leg('circular-500 measured against advisory target; invalid or missing samples still fail', () => {
  const r = node('scripts/gates/check-circular-advisory.mjs');
  const measurement = r.stdout.trim();
  return { ok: r.status === 0 && measurement.length > 0, detail: measurement || r.stderr.trim() || 'missing circular measurement' };
});
leg('circular layout correctness remains blocking', () => tests('packages/layout/src/circular.test.ts'));
leg('circular exception changes only timing enforcement', () =>
  namedCases('tests/harness/circular-advisory.test.mjs', [
    'circular overrun is advisory',
    'other layout overruns fail',
    'missing or invalid circular samples fail',
  ]),
);
leg('complete current-revision mutation reports preserve scope and floors within existing timeout', () =>
  command('scripts/gates/check-mutation-evidence.mjs', ['--milestone', 'M18']),
);
leg('mutation aggregation rejects incomplete and failing shards', () =>
  namedCases('tests/harness/mutation-shards.test.mjs', ['missing shard fails', 'failed shard fails', 'all sources and floors preserved']),
);
leg('Mermaid ampersand lists and numeric IDs retain nodes and edges', () => tests('packages/dsl/src/import/mermaid-lists.test.ts'));

leg('licensed import corpora are pinned before converter implementation', () =>
  namedCases('tests/harness/import-corpus.test.mjs', [
    'SVG corpus pins 50 distinct inputs and feature coverage',
    'draw.io library denominators include every entry',
    'fixture provenance and checksums are valid',
  ]),
);

leg('pinned font engines preserve bounds, padding and CSP', () =>
  namedCases('tests/harness/font-engine.test.mjs', [
    'pinned font binaries rebuild identically and retain notices',
    'malformed fonts and dirty output buffers remain bounded and deterministic',
    'font workers allow WASM while blocking JavaScript evaluation',
  ]),
);

// the local test checks recorded reproductions; the rebuild itself runs in the font-engine workflow (M18.109, cp11 F6)
leg('a pinned-toolchain CI rebuild reproduces the committed woff2-codec.wasm', () => command('scripts/gates/check-font-engine-evidence.mjs'));

leg('checked artwork preserves paint and scopes references without changing legacy rendering', () => {
  const artwork = tests('packages/render/src/artwork-view.browser.test.tsx', { project: 'browser' });
  return artwork === true ? tests('packages/render/src/shape-view.browser.test.tsx', { project: 'browser' }) : artwork;
});

leg('3 of 5000 definitions embedded and render after offline reopen', () => {
  const archive = tests('packages/format/src/embed-used.test.ts');
  return archive === true
    ? playwrightSpecs(['e2e/file.used-shapes.spec.ts'], ['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari'], { runner: imageRunner() })
    : archive;
});

leg('SVG sanitizer, outlines, color mapping and >=4 anchors', () => {
  const sanitizer = tests('packages/format/src/sanitize-svg.test.ts');
  if (sanitizer !== true) return sanitizer;
  const converter = tests('packages/format/src/svg-import.test.ts');
  return converter === true
    ? playwrightSpecs(['e2e/svg-import.spec.ts', 'e2e/artwork.viewport.spec.ts', 'e2e/svg-witness-corpus.spec.ts'], ['chromium', 'firefox', 'webkit'], {
        runner: imageRunner(),
      })
    : converter;
});

// FR-LIB-004 batch import through the CLI host (ADR-0206, M18.171): the format batch suite and the corpus/bounds suite against the built bin, not an editor wrapper (cp9 F3)
leg('50 SVG batch imports, bounded ZIP and traversal rejection', () => {
  const batch = tests('packages/format/src/svg-batch.test.ts');
  return batch === true ? tests('packages/cli/src/e2e/cli.pack-import.test.ts') : batch;
});

leg('imported artwork retains exact licensed fonts offline', () => {
  const retained = tests('packages/format/src/artwork-font-retention.test.ts');
  if (retained !== true) return retained;
  const installed = tests('packages/cli/src/e2e/cli.artwork-fonts.test.ts');
  return installed === true ? playwrightSpecs(['e2e/artwork.font-retention.spec.ts'], ['chromium', 'firefox', 'webkit'], { runner: imageRunner() }) : installed;
});

const featureTests = [
  ['direct-pack artwork rejects unsafe nodes, references and excessive resources', 'packages/core/src/shape/artwork.test.ts'],
  ['pack schema rejects invalid definitions and missing license', 'packages/core/src/shape/pack-schema.test.ts'],
  ['lazy index and geometry loading', 'packages/sdk/src/pack-loader.test.ts'],
  ['Iconify complete collection with searchable names and aliases', 'packages/editor/src/library/import-iconify.test.ts'],
  ['draw.io fixture metric >=90 percent and safe XML', 'packages/editor/src/library/import-drawio.test.ts'],
  ['used-pack attribution survives portable save/open', 'packages/format/src/pack-attribution.test.ts'],
  ['My shapes styled groups export/import across documents', 'packages/editor/src/library/my-shapes.test.ts'],
  ['replace preserves text, style, anchors, connections and undo', 'packages/core/src/commands/replace-shape.test.ts'],
  ['wavy/zigzag/double/pipe/cable route decoration goldens', 'packages/render/src/pack-connectors.test.ts'],
  ['valid WOFF2 used-glyph subset <=60000 bytes and deterministic fingerprints', 'packages/editor/src/font-subset.test.ts'],
];
for (const [name, file] of featureTests) leg(name, () => tests(file));
const PACKS = [
  'basic',
  'flowchart',
  'arrows',
  'callouts',
  'infographic',
  'uml',
  'bpmn-lite',
  'network',
  'cloud-architecture',
  'icons-lucide',
  'devices',
  'people',
];
for (const pack of PACKS) leg(`${pack}: every definition validates and has a nonempty passing visual golden`, () => tests(`packs/${pack}/src/pack.test.ts`));
leg('all first-party packs searchable within library search budget', () => tests('packages/editor/src/library/first-party-packs.test.ts'));
leg('pack licenses and attribution policy enforced', () => {
  const checked = command('scripts/gates/check-licenses.mjs', ['--packs']);
  return checked === true
    ? namedCases('tests/harness/licenses.test.mjs', [
        'asset-only licenses do not authorize code dependencies',
        'missing pack notices and forbidden asset licenses fail',
      ])
    : checked;
});
// This probe prevents a currently ignored --packs option from standing in for the policy.
leg('pack license gate rejects missing and forbidden licenses', () =>
  namedCases('tests/harness/licenses.test.mjs', ['pack missing license fails', 'pack forbidden license fails']),
);
for (const spec of ['library.import-svg', 'library.my-shapes', 'library.replace-shape', 'library.pack-credits', 'library.font-subset'])
  leg(`${spec}: Chromium, Firefox, WebKit; no retries`, () =>
    playwrightSpecs([`e2e/${spec}.spec.ts`], ['chromium', 'firefox', 'webkit'], { runner: imageRunner() }),
  );
// the font-subset half is the built bin's convert --subset-fonts e2e (M18.204, cp28 F2): pack import alone never ran it
leg('CLI pack import and font-subset option exercise real files', () => {
  const imported = tests('packages/cli/src/pack-import.test.ts');
  return imported === true ? tests('packages/cli/src/e2e/cli.subset-fonts.test.ts') : imported;
});
leg('all pack names resolve through DSL and bounded catalog detail', () => tests('packages/dsl/src/catalog/pack-catalog.test.ts'));
leg('core AI catalog remains within AI_CATALOG_MAX_TOKENS', () => tests('packages/dsl/src/catalog/token-budget.test.ts'));
leg('cloud architecture example renders to its golden', () => {
  for (const file of ['examples/dsl/cloud-architecture.flux.yaml', 'examples/dsl/__golden__/cloud-architecture.svg'])
    if (!exists(file)) return `missing ${file}`;
  if (!readText('scripts/dsl/examples.test.ts').includes("matchesGolden('cloud-architecture')")) return 'cloud architecture golden not exercised';
  return tests('scripts/dsl/examples.test.ts', { config: 'scripts/dsl/examples.config.ts' });
});
leg('pack authoring docs cover versioning, imports, licenses and used-definition persistence', () => {
  const text = readText('docs/architecture/09-extensibility.md') + readText('docs/guides/pack-authoring.md');
  return ['ADR-0048', 'ADR-0049', 'ADR-0050', 'ADR-0051'].every((id) => text.includes(id)) || 'missing pack decision references';
});
leg(
  'no open M18 spec folders',
  () => readdirSync(repoPath('specs')).every((name) => !/^M18(?:[.-]|$)/.test(name)) || 'archive completed M18 specs into living docs',
);
leg('no open test quarantines', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout.split(/\r?\n/).filter((line) => line && !line.includes('tests/harness/'));
  return hits.length === 0 || hits.slice(0, 3).join(' | ');
});
leg('changesets cover changed packages', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M18\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M18 commits yet';
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
leg('three-OS CI and nightly perf cover final review range', () => command('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M18', '--perf']));
leg('all M18 backlog rows done including review findings', () => checkBacklogDone(backlogTextFor('M18'), 'M18', loadMilestoneReviews('M18')));
leg('independent final review covers M18', () =>
  exists('.harness/reviews/milestone-M18-final.json') ? checkFinalReview(json('.harness/reviews/milestone-M18-final.json'), 'M18') : 'missing M18 final review',
);
leg('roadmap advanced past M18', () => Number(currentMilestone()?.slice(1)) > 18 || `current milestone ${currentMilestone()}`);
await runLegs('m18');
