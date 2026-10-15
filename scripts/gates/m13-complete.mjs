#!/usr/bin/env node
// Completion gate for M13 — Layout engine v1 (docs/milestones/M13.md). Written first and red (M13.1). Legs are behavioural: each runs the real
// test, bench, spec or gate. The rows that write a test add its exact titles to its list here (none is guessed at plan time; M12 cp1 F1 and
// final F1: a row's commit edits this file or says why not). M13 started while M12 waits for CI evidence, so this gate does not wait for M12.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createE2e, DESKTOP } from './editor-gate.mjs';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  benchUnder,
  changesetsCoverRange,
  checkBacklogDone,
  checkFinalReview,
  checkRowsTitled,
  coverageGaps,
  loadMilestoneReviews,
  titled,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);
const EXACT = { exact: true };
const DECISIONS = 'docs/architecture/decisions';

const { e2e } = createE2e({ desktop: { projects: DESKTOP, specs: ['e2e/layout.arrange-selection.spec.ts'] } });

// ── requirements ───────────────────────────────────────────────────────────────────────────────────
leg('check-trace --milestone M13 --priority M,S green: every requirement of the plan has a test naming it', () => {
  const plan = exists('docs/milestones/M13.md') ? readText('docs/milestones/M13.md') : '';
  const planIds = (plan.match(/^## Requirements\r?\n([\s\S]*?)(?:^## )/m)?.[1] ?? '').match(/\b(?:FR|NFR)-[A-Z][A-Z0-9]*-\d{3}\b/g);
  if (!planIds?.length) return 'docs/milestones/M13.md: no requirement IDs under ## Requirements';
  const matrix = readText('docs/requirements/40-traceability.md');
  const unassigned = planIds.filter((id) => !new RegExp(`^\\| ${id} \\|[^|]*\\|[^|]*\\|[^|]*\\bM13\\b`, 'm').test(matrix));
  if (unassigned.length) return `40-traceability.md does not assign ${unassigned.join(', ')} to M13`;
  return ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M13', '--priority', 'M,S']));
});

// ── decisions ──────────────────────────────────────────────────────────────────────────────────────
function adrLeg(num, also) {
  return () => {
    const file = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', DECISIONS])
      .stdout.split(/\r?\n/)
      .find((f) => f.startsWith(`${DECISIONS}/ADR-${num}-`));
    if (!file) return `no ADR-${num} in ${DECISIONS}`;
    const text = readText(file);
    const missing = also.filter((w) => !new RegExp(w, 'i').test(text));
    if (missing.length) return `${file} does not mention ${missing.join(', ')}`;
    return /^status:\s*accepted\s*$/m.test(text) || `${file} is not accepted`;
  };
}
leg('ADR-0033 layout engine contract v1 is accepted', adrLeg('0033', ['LayoutAlgorithm', 'LayoutEngine', 'worker', 'revision', 'fingerprint', 'AbortSignal']));
leg('ADR-0034 overlap removal and determinism is accepted', adrLeg('0034', ['VPSC', 'sfc32', 'quantiz', 'dagre', 'licen', 'ladder']));
leg('packages/layout is pure: check-layering passes', () => ok(node('scripts/gates/check-layering.mjs')));

// ── the engine (T0/T1 under exact titles; rows add them) ───────────────────────────────────────────
const LAYOUT_TITLES = [
  ['M13.5', 'FR-LAY-001: a registered layout is listed with its id, version and options schema', 'layout'],
  ['M13.5', 'FR-LAY-001: a value without an options schema, capabilities, run or parseOptions is refused at registration', 'layout'],
  ['M13.5', 'FR-LAY-001: the options schema of stack agrees with parseOptions on defaults and on refusals', 'layout'],
  ['M13.5', 'FR-LAY-001: the options of a layout are published as JSON Schema', 'layout'],
  ['M13.5', 'FR-LAY-001: a layout registered through registerLayout resolves by name and a mistyped option is a diagnostic', 'dsl'],
  ['M13.6', 'FR-LAY-005: the snapshot of a screen equals its golden input', 'layout'],
  ['M13.6', 'FR-LAY-005: a selection scope keeps the selected nodes and the edges between them, and drops a parent that is not selected', 'layout'],
  ['M13.6', "FR-LAY-005: a container scope covers the container's descendants, frames on its own box, and keeps nested parents", 'layout'],
  ['M13.6', 'FR-LAY-005: the snapshot does not depend on the order of the records, and hidden, other-screen and boxless elements are left out', 'layout'],
  ['M13.6', 'FR-LAY-005: hints are the role, tags and plain data of the semantic field, never the slug or label', 'layout'],
  ['M13.6', 'FR-LAY-005: a connector with one bound end, a hidden connector, one on another screen or bound outside the set is not an edge', 'layout'],
  ['M13.6', 'FR-LAY-005: two bindings for one end resolve by binding id, whatever the record order', 'layout'],
  ['M13.6', 'FR-LAY-005: hidden hides the whole subtree, and a container scope on a hidden container has nothing to lay out', 'layout'],
  ['M13.6', 'FR-LAY-005: tag hints keep strings only and are copies, and a rotated element keeps its stored footprint', 'layout'],
  ['M13.7', 'FR-LAY-002: fixture grid-3x3 gives row-major boxes in equal cells with the configured gap', 'layout'],
  ['M13.7', 'FR-LAY-002: align centres or ends a box in its cell, on the half-pixel grid', 'layout'],
  ['M13.7', 'FR-LAY-002: columns, padding and the frame origin set where the grid starts and how wide a row is', 'layout'],
  ['M13.7', 'FR-LAY-002: pinned boxes are not moved and the grid skips the cells they cover', 'layout'],
  ['M13.7', 'FR-LAY-002: the same input gives the same boxes, and no unpinned box overlaps another, for any sizes, gaps, columns, frame and pins', 'layout'],
  ['M13.7', 'FR-LAY-002: zero-size boxes inside a huge pin, and a pin covering most of the screen, still finish and clear the pin', 'layout'],
  ['M13.7', 'FR-LAY-001: the grid options are checked with a message naming the bad one, and the schema agrees', 'layout'],
  ['M13.7', 'FR-LAY-001: the built-in layouts register under their names', 'layout'],
  ['M13.7', 'FR-LAY-002: fixture stack-wrap starts a new line beside the first when a box would pass the wrap length', 'layout'],
  ['M13.7', 'FR-LAY-002: wrapped lines never overlap for fractional sizes, gaps and alignments, and a pin may push a line past the wrap length', 'layout'],
  ['M13.7', 'FR-LAY-005: a parent cycle (a merged or corrupt file) neither hangs the snapshot nor hides the elements in it', 'layout'],
  ['M13.8', 'FR-LAY-002: fixture layered-diamond gives golden boxes for each direction, ranks one rank gap apart', 'layout'],
  ['M13.8', 'FR-LAY-002: padding and the frame origin set where the diagram starts, and the gaps are the configured ones', 'layout'],
  ['M13.8', 'FR-LAY-008: the same input twice, and the same graph given in another order, give the same boxes', 'layout'],
  ['M13.8', 'FR-LAY-008: ids such as constructor and __proto__ are laid out like any other', 'layout'],
  ['M13.8', 'FR-LAY-002: pinned nodes keep their boxes, still rank through their edges, and the rest start at the padded frame origin', 'layout'],
  ['M13.8', 'FR-LAY-002: unconnected nodes, an empty input, self loops, duplicate edges and edges to unknown nodes all lay out', 'layout'],
  ['M13.8', 'FR-LAY-008: for any graph the output is deterministic, covers every node, and boxes keep their sizes', 'layout'],
  ['M13.8', 'FR-LAY-002: spacing presets set the gaps, and nodeGap and rankGap override them', 'layout'],
  ['M13.8', 'FR-LAY-001: the layered options are checked with a message naming the bad one, and the schema agrees', 'layout'],
  ['M13.8', 'FR-LAY-008: every built-in keeps a box for a node whose id is __proto__', 'layout'],
  ['M13.9', 'FR-LAY-004: the pins pass puts a pinned node back on its input box, whatever the algorithm did to it', 'layout'],
  ['M13.9', 'FR-LAY-004: the pins pass adds a pinned node the algorithm left out and drops ids the input does not have', 'layout'],
  ['M13.9', 'FR-LAY-008: the snap pass rounds positions to the half pixel, halves toward +infinity, and never produces -0', 'layout'],
  ['M13.9', 'FR-LAY-008: snapping leaves pinned boxes exact, and is idempotent for any boxes', 'layout'],
  ['M13.10', 'FR-LAY-004: a fixture of overlapping boxes ends with a margin between them, the earlier box where it was', 'layout'],
  ['M13.10', 'FR-LAY-004: pinned boxes do not move, and the other box of a pair moves clear of them', 'layout'],
  ['M13.10', 'FR-LAY-004: overlapping pinned pairs stay, are counted, and every other box keeps clear of both', 'layout'],
  ['M13.10', 'FR-LAY-004: a box with no free place nearby, or in a pile of identical boxes, still ends clear of every other', 'layout'],
  ['M13.10', 'FR-LAY-004: preferAxis chooses the axis a pair is separated along, margin the space left, and ids without a box are ignored', 'layout'],
  [
    'M13.10',
    'FR-LAY-004: for any boxes and pins no unpinned box overlaps or touches another, pinned boxes and sizes are unchanged, and the result is deterministic',
    'layout',
  ],
  [
    'M13.11',
    'FR-LAY-004: a pair is separated by exactly the distance that clears it, a contained box is pushed all the way out, and margin 0 is allowed',
    'layout',
  ],
  ['M13.11', 'FR-LAY-004: an id the algorithm left out is ignored even when it is __proto__, and 1000 boxes in a pile end clear of each other', 'layout'],
  [
    'M13.11',
    'FR-LAY-004: for random graphs, every built-in plus the post-passes leaves unpinned boxes clear of every other box and pinned boxes unmoved',
    'layout',
  ],
  ['M13.12', 'FR-LAY-005: fixture nested-containers sizes a container to its children plus the inset and puts them inside it', 'layout'],
  ['M13.12', 'FR-LAY-005: containers inside containers are laid out deepest first and move with their parent', 'layout'],
  ['M13.12', 'FR-LAY-005: a pinned container keeps its box and lays its children out inside it; one with a pinned node below it keeps its box too', 'layout'],
  ['M13.12', 'FR-LAY-005: a parent that is missing, its own or in a cycle makes the node a root, and every node still gets a box', 'layout'],
  ['M13.12', 'FR-LAY-005: the runner gets the container id, the edges between siblings, and a container frame of its own', 'layout'],
  [
    'M13.12',
    'FR-LAY-005: for random trees of depth up to 3 every unpinned container holds its children, siblings stay clear, pinned boxes are exact and the result is deterministic',
    'layout',
  ],
  ['M13.13', 'FR-LAY-008: the same request twice gives equal boxes and fingerprint, whatever the order of nodes, edges and keys', 'layout'],
  ['M13.13', 'FR-LAY-008: the fingerprint changes with the input, options, seed, algorithm version, font hash and post-passes', 'layout'],
  ['M13.13', 'FR-LAY-004: the pipeline puts pinned nodes back, removes overlap, snaps, and counts overlapping pinned pairs', 'layout'],
  ['M13.13', 'FR-LAY-008: the algorithm gets a seeded stream: the same seed gives the same boxes, another seed other ones', 'layout'],
  [
    'M13.13',
    'FR-LAY-001: a duplicate id, a non-finite box or frame, bad options, a throwing algorithm or non-finite output is a LayoutError, not an exception',
    'layout',
  ],
  [
    'M13.13',
    'FR-LAY-008: the cache returns the stored result for an identical request without running the algorithm, and misses when anything differs',
    'layout',
  ],
  [
    'M13.14',
    'FR-LAY-001: options that throw, hold a BigInt, a cycle or a number that is not finite, and a NaN order, are LayoutError results; -0 and 0 fingerprint apart',
    'layout',
  ],
  ['M13.14', "FR-LAY-008: a result is frozen, so a caller cannot change what the cache hands the next one, and the input boxes stay the caller's", 'layout'],
  ['M13.15', 'FR-LAY-005: arranging a screen lays its elements out with the chosen algorithm as one undo step, and undo restores every box', 'layout'],
  ['M13.15', 'FR-LAY-005: arranging a selection moves only the selection, keeps clear of the rest, and leaves the rest where it was', 'layout'],
  ['M13.15', 'FR-LAY-005: arranging a container lays its children out inside its frame, and a container layout spec picks the algorithm', 'layout'],
  [
    'M13.15',
    'FR-LAY-001: arrange refuses an unknown algorithm, an option the algorithm rejects, an empty screen and an unknown container, and changes nothing',
    'layout',
  ],
  ['M13.16', 'FR-LAY-005: the screen is laid out whole, and the selection among the rest, with the chosen layout', 'editor'],
  ['M13.16', 'FR-LAY-005: a selected group is laid out by its own layout; anything else is refused', 'editor'],
  ['M13.16', 'FR-LAY-001: a refusal by the document comes back as false, and each choice has a screen and a selection command', 'editor'],
  ['M13.17', 'FR-LAY-001: a screen without a layout is laid out by layered: connectors give the ranks, and nothing overlaps', 'dsl'],
  ['M13.17', 'FR-DSL-005: `layered`, named by v1 but not registered by the host, places with stack and warns FLX_DSL_NOT_YET at the layout', 'dsl'],
  ['M13.17', 'FR-DSL-005: in a mixed fixture pinned boxes are exact and the others are placed without overlap', 'dsl'],
  [
    'M13.18',
    'FR-LAY-007: a revision that is not a finite number is refused as LAYOUT_INPUT_INVALID, and an abort listener is removed on every way a job ends',
    'layout',
  ],
  ['M13.18', 'FR-LAY-002: a graph of more than 200 nodes is ranked quickly, ranks still run along the direction, and the result is deterministic', 'layout'],
  ['M13.29', 'FR-LAY-007: a flat screen arranged in a worker gets the boxes layout.arrange gives, as one undo step', 'layout'],
  ['M13.29', 'FR-LAY-005: a plan with nested containers is laid out by layout.arrange on the caller and no worker starts', 'layout'],
  ['M13.29', 'FR-LAY-007: a screen edited while the worker ran is refused and nothing is written', 'layout'],
  ['M13.29', 'FR-LAY-007: a newer arrange of a screen supersedes the older one, which rejects with AbortError', 'layout'],
  [
    'M13.29',
    'FR-LAY-005: a request layout.arrange would refuse comes back as an error with nothing started, and applyBoxes writes only elements of the screen',
    'layout',
  ],
  ['M13.30', 'FR-LAY-007: with a background runner the Arrange is taken at once, says it is working, and then clears or says why it failed', 'editor'],
  ['M13.30', 'FR-LAY-007: an Arrange runs in the worker, moves the elements, is one undo step, and a refusal comes back as a message', 'apps/studio'],
  // ['M13.k', '<exact title>', 'layout', {}, 'node']
];
leg('the layout algorithms, snapshot, passes and cache are tested under their requirement titles (T0)', () =>
  LAYOUT_TITLES.length === 0 ? 'no layout titles yet: the M13 rows add them' : titled(LAYOUT_TITLES, EXACT),
);
const SEMANTIC_TITLES = [
  ['M13.4', 'FR-DOC-007: element.update of style leaves semantic byte-equal, extra data keys included', 'core'],
  ['M13.4', 'FR-DOC-007: element.updateMany of style leaves the semantic of every target byte-equal', 'core'],
  ['M13.4', 'FR-DOC-007: a semantic with extra data keys survives serialize and parse unchanged', 'schema'],
];
leg('FR-DOC-007: an element keeps its semantic data byte-equal through every style command (T0)', () =>
  SEMANTIC_TITLES.length === 0 ? 'no semantic titles yet: M13.4 adds them' : titled(SEMANTIC_TITLES, EXACT),
);
const WORKER_TITLES = [
  ['M13.14', 'FR-LAY-007: a job goes to the worker and its result is the one layoutSync gives', 'layout'],
  ['M13.14', 'FR-LAY-007: aborting a running job rejects with AbortError, ends its worker, and the next job runs on a fresh one', 'layout'],
  ['M13.14', 'FR-LAY-007: a reply of an older job or with the wrong id never settles a newer job of the same scope', 'layout'],
  ['M13.14', 'FR-LAY-007: a newer revision of a scope supersedes the running one, and an older revision is refused at once', 'layout'],
  ['M13.14', 'FR-LAY-007: jobs of different scopes run side by side, and dispose ends every worker and rejects what is in flight', 'layout'],
  [
    'M13.14',
    'FR-LAY-007: an aborted signal rejects before any worker starts, a worker error is a LAYOUT_FAILED result, and an unknown algorithm is LAYOUT_ALGORITHM_UNKNOWN',
    'layout',
  ],
  [
    'M13.14',
    'FR-LAY-007: a worker that cannot be started, cannot be sent the job, sends an unreadable message or cannot be ended still settles the job',
    'layout',
  ],
  ['M13.14', 'FR-LAY-007: serveLayoutWorker answers each job with done or error and ignores cancel and messages of other protocols', 'layout'],
];
leg('FR-LAY-007: aborting a layout job rejects with AbortError and a stale revision is discarded (T1)', () =>
  WORKER_TITLES.length === 0 ? 'no worker titles yet: M13.14 adds them' : titled(WORKER_TITLES, EXACT),
);
leg('the no-overlap property and the determinism harness pass at the CI seed', () => {
  const file = 'packages/layout/src/no-overlap.prop.test.ts';
  return exists(file) ? ok(run('pnpm', ['exec', 'vitest', 'run', '--project', 'node', file])) : `missing ${file}`;
});
const UNTITLED_ROWS = {};
leg('every done M13 row whose acceptance names a T0 or T1 test has a title in a leg (or a reasoned exemption)', () =>
  checkRowsTitled(backlogTextFor('M13'), 'M13', [LAYOUT_TITLES, SEMANTIC_TITLES, WORKER_TITLES, SIZE_TITLES, GOLDEN_TITLES], UNTITLED_ROWS),
);

// ── the editor and the compiler ────────────────────────────────────────────────────────────────────
leg('arrange selection leaves no overlap and one undo restores it (three engines)', () => e2e(['e2e/layout.arrange-selection.spec.ts'], DESKTOP));
leg('a mixed DSL fixture keeps its pins and lays out the rest with no overlap; examples/dsl/layered-flow.flux.yaml compiles (T0)', () => {
  if (!exists('examples/dsl/layered-flow.flux.yaml')) return 'missing examples/dsl/layered-flow.flux.yaml';
  return ok(run('pnpm', ['--filter', '@fluxion/dsl', 'run', 'test:examples']));
});

// ── size and speed ─────────────────────────────────────────────────────────────────────────────────
const SIZE_TITLES = [['M13.20', 'NFR-SIZE-005: the one-file player and a saved .flux.html of a laid-out document hold no layout engine code', 'format']];
const GOLDEN_TITLES = [];
leg('NFR-SIZE-005: a saved file of a laid-out document and the player contain no layout module (T0)', () =>
  SIZE_TITLES.length === 0 ? 'no size titles yet: M13.20 adds them' : titled(SIZE_TITLES, EXACT),
);
leg('examples/dsl/layered-flow.flux.yaml renders to its golden SVG (T3)', () =>
  GOLDEN_TITLES.length === 0 ? 'no golden titles yet: M13.21 adds them' : titled(GOLDEN_TITLES, EXACT),
);
leg(`size-limit: player core ≤ PLAYER_CORE_GZIP (${t('PLAYER_CORE_GZIP')})`, () => {
  const r = run('pnpm', ['exec', 'size-limit', '--json']);
  const entries = r.status === 0 ? JSON.parse(r.stdout) : null;
  if (!entries) return `size-limit failed: ${ok(r)}`;
  const core = entries.find((e) => e.name === 'player core')?.size;
  return (core !== undefined && core <= t('PLAYER_CORE_GZIP')) || `player core ${core} > PLAYER_CORE_GZIP`;
});
leg('packages/layout has a ./worker entry and worker glue lives only under src/worker', () => {
  const pkg = json('packages/layout/package.json');
  if (!pkg?.exports?.['./worker']) return 'packages/layout/package.json has no ./worker export';
  const r = run('git', ['grep', '-l', '-I', '-E', 'new Worker|postMessage|self\\.addEventListener', '--', 'packages/layout/src']);
  const stray = r.stdout.split(/\r?\n/).filter((f) => f && !f.includes('/src/worker/') && !f.endsWith('.test.ts'));
  return stray.length === 0 || `worker glue outside src/worker: ${stray.join(', ')}`;
});
// the threshold and no more than 15 % over the recorded baseline (perf-baseline.json: { "layered-100": p99 ms, ... })
function benchLeg(file, name, limit) {
  const baseline = json('perf-baseline.json')?.[name];
  if (typeof baseline !== 'number') return `perf-baseline.json has no "${name}" entry`;
  return benchUnder(file, name, Math.min(limit, baseline * 1.15));
}
leg(`layered 100 nodes within LAYOUT_100_NODES_MS (${t('LAYOUT_100_NODES_MS')} ms, p99) and 15 % of its baseline`, () =>
  benchLeg('packages/layout/bench/layered-100.bench.ts', 'layered-100', t('LAYOUT_100_NODES_MS')),
);
leg(`layered 500 nodes in the worker within LAYOUT_500_NODES_MS (${t('LAYOUT_500_NODES_MS')} ms, p99) and 15 % of its baseline`, () =>
  benchLeg('packages/layout/bench/layered-500.bench.ts', 'layered-500', t('LAYOUT_500_NODES_MS')),
);
leg('the nightly perf job runs the layout benches, perf.layout-500.spec.ts, perf.drag-500 and hit-test-2000 (not a SKIP echo)', () => {
  const text = exists('.github/workflows/nightly.yml') ? readText('.github/workflows/nightly.yml') : '';
  const perf = text.match(/^ {2}perf:\r?\n([\s\S]*?)(?=^ {2}\S|$(?![\s\S]))/m)?.[1] ?? '';
  const missing = ['layered-100', 'layered-500', 'perf.layout-500', 'perf.drag-500', 'hit-test-2000'].filter((w) => !perf.includes(w));
  return (perf && !/SKIP/.test(perf) && missing.length === 0) || `nightly perf job: ${perf ? `lacks ${missing.join(', ') || 'SKIP removal'}` : 'not found'}`;
});
leg(
  'a 500-node Arrange leaves no main-thread task over 50 ms before the boxes are written (T4 perf.layout-500.spec.ts; the write itself is backlog M13.31)',
  () => {
    const file = 'e2e/perf.layout-500.spec.ts';
    return exists(file) ? ok(run('pnpm', ['exec', 'playwright', 'test', file, '--project=perf'])) : `missing ${file}`;
  },
);

// ── coverage, changesets, quarantines ──────────────────────────────────────────────────────────────
function coverageLeg(pkg, floors) {
  const out = mkdtempSync(join(tmpdir(), 'm13-cov-'));
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
    const { numFailedTests, numPassedTests } = JSON.parse(readFileSync(report, 'utf8'));
    if (numFailedTests > 0 || numPassedTests === 0) return `${pkg}: ${numFailedTests} failed, ${numPassedTests} passed`;
    const summary = join(out, 'coverage-summary.json');
    return existsSync(summary) ? coverageGaps(JSON.parse(readFileSync(summary, 'utf8')), pkg, floors, 300) : `no coverage summary: ${ok(r)}`;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
leg('packages/layout coverage at or above COVERAGE_PURE_LINES/BRANCHES', () =>
  coverageLeg('packages/layout', { lines: t('COVERAGE_PURE_LINES'), branches: t('COVERAGE_PURE_BRANCHES') }),
);
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M13\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M13 commits yet';
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
leg('CI green on ubuntu, windows and macos at or after the M13 final review range', () => {
  if (!exists('.harness/reviews/milestone-M13-final.json')) return 'no M13 final review yet: its range end is what the evidence must cover';
  return ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M13']));
});
leg('every M13 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M13'), 'M13', loadMilestoneReviews('M13')));
leg('final milestone review covers M13', () => {
  const rev = json('.harness/reviews/milestone-M13-final.json');
  return rev ? checkFinalReview(rev, 'M13') : 'missing .harness/reviews/milestone-M13-final.json';
});
leg('roadmap advanced past M13', () => !/^M(\d|1[0-3])$/.test(currentMilestone() ?? '') || `roadmap Current milestone is ${currentMilestone()}`);

await runLegs('m13');
