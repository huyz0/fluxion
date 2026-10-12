#!/usr/bin/env node
// Completion gate for M12 — FluxScript DSL compiler (docs/milestones/M12.md). Written first and red (M12.1). Legs are behavioural: each runs
// the real test, spec, script or gate. Test titles are not guessed at plan time (a plan-time title no test carries hid gaps in M10): the row
// that writes a test adds its exact titles to its leg here. M9's and M10's open rows (M9.11, M9.23, M9.28, M10.22) are unscheduled hand-offs
// (roadmap Current line), so this gate does not wait for them.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createE2e, DESKTOP } from './editor-gate.mjs';
import { currentMilestone, exists, leg, listFiles, node, readText, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  benchUnder,
  changesetsCoverRange,
  checkBacklogDone,
  checkFinalReview,
  checkRowsTitled,
  coverageGaps,
  loadMilestoneReviews,
  propertyRuns,
  readmeGaps,
  titled,
  verifyLeg,
} from './milestone-checks.mjs';
import { THRESHOLDS, t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const pnpm = (...a) => run('pnpm', a);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);
const DSL = 'dsl';
const EXAMPLES = 'examples/dsl';
// a title is matched whole: a test renamed by adding words no longer counts (M12.50)
const EXACT = { exact: true };
const ROUNDTRIP = 'packages/dsl/src/roundtrip.prop.test.ts';
const ROUNDTRIP_TITLE = 'FR-DSL-002: compile(decompile(compile(src))) equals compile(src) for generated sources';

const { e2e } = createE2e({
  desktop: { projects: DESKTOP, specs: ['e2e/source-view.two-way-sync.spec.ts', 'e2e/dsl.streaming-render.spec.ts'] },
});

// every requirement of the plan, Should included, has a running test naming it (M12 cp1 F2): check-trace counts a titled test that is not
// skipped; that it passes is the verify leg's (its test step runs every Vitest and node:test file) and the e2e leg's (the two specs)
leg('check-trace --milestone M12 --priority M,S green: every requirement of the plan, Should included, has a test naming it', () => {
  const plan = exists('docs/milestones/M12.md') ? readText('docs/milestones/M12.md') : '';
  const planIds = (plan.match(/^## Requirements\r?\n([\s\S]*?)(?:^Enables later|^## )/m)?.[1] ?? '').match(/\b(?:FR|NFR)-[A-Z][A-Z0-9]*-\d{3}\b/g);
  if (!planIds?.length) return 'docs/milestones/M12.md: no requirement IDs under ## Requirements';
  // check-trace scopes by the matrix Milestone(s) column, so a plan ID the matrix does not give M12 would escape it
  const matrix = readText('docs/requirements/40-traceability.md');
  const unassigned = planIds.filter((id) => !new RegExp(`^\\| ${id} \\|[^|]*\\|[^|]*\\|[^|]*\\bM12\\b`, 'm').test(matrix));
  if (unassigned.length) return `40-traceability.md does not assign ${unassigned.join(', ')} to M12`;
  return ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M12', '--priority', 'M,S']));
});

// ── decisions ────────────────────────────────────────────────────────────────────────────────────────
const DECISIONS = 'docs/architecture/decisions';
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
leg(
  'ADR-0030 FluxScript grammar v1 is accepted',
  adrLeg('0030', ['slug', 'anchor', '->', '<-', '<->', '--', '~>', 'FLX_DSL_NOT_YET', 'codes\\.ts', 'additive']),
);
leg('ADR-0031 stable ids and placement is accepted', adrLeg('0031', ['hash128', 'base62', 'placement', 'screen\\.layout', '1\\.3', 'migration']));
leg('ADR-0032 source view is accepted', adrLeg('0032', ['CodeMirror', 'Lezer', 'TextMate', 'debounce', 'undo']));

// ── the compiler (FR-DSL-001, FR-DSL-002, FR-DSL-005, FR-DSL-006) ─────────────────────────────────────
leg('packages/dsl is pure: check-layering passes', () => ok(node('scripts/gates/check-layering.mjs')));
leg(`${EXAMPLES} holds at least 8 examples, checkout.flux.yaml among them`, () => {
  if (!exists(EXAMPLES)) return `missing ${EXAMPLES}`;
  const files = listFiles(EXAMPLES, (p) => p.endsWith('.flux.yaml'));
  if (files.length < 8) return `${files.length} examples in ${EXAMPLES} (< 8)`;
  return exists(`${EXAMPLES}/checkout.flux.yaml`) || `missing ${EXAMPLES}/checkout.flux.yaml`;
});
// test:examples compiles every example twice: 0 errors, byte-identical .flux.json, and only FLX_DSL_NOT_YET warnings for checkout (M12 row)
leg('every example compiles with 0 errors, twice to the same bytes; checkout.flux.yaml warns only FLX_DSL_NOT_YET (test:examples)', () =>
  ok(pnpm('--filter', '@fluxion/dsl', 'run', 'test:examples')),
);
leg('the round-trip property compile(decompile(compile(src))) = compile(src) passes at the CI seed', () => {
  if (!exists(ROUNDTRIP)) return `missing ${ROUNDTRIP}`;
  const r = ok(pnpm('exec', 'vitest', 'run', '--project', 'node', ROUNDTRIP));
  if (r !== true) return r;
  // the property's own title: a bare requirement id matched no test, so the run count was never read (M12.16)
  const runs = propertyRuns(readText(ROUNDTRIP), ROUNDTRIP_TITLE);
  if (Number.isNaN(runs)) return `${ROUNDTRIP}: numRuns is computed and cannot be read: use a number or a constant`;
  return runs > 0 || `${ROUNDTRIP}: no test titled "${ROUNDTRIP_TITLE}" with a fixed numRuns`;
});
// the rows that write these tests add their exact titles (parse ranges, diagnostics with hints, placement, determinism); each entry names
// its row, and the row-title leg below refuses a done T0 or T1 row with none (M12.45)
const COMPILER_TITLES = [
  ['M12.7', 'FR-DSL-006: the formatter ranks errors first then by position, dedupes one per root cause, and caps the list', DSL],
  ['M12.8', 'FR-DSL-001: every construct parses with its line and column', DSL],
  ['M12.8', 'FR-DSL-001: a syntax error is a diagnostic at its line and column, and the tree is absent', DSL],
  ['M12.9', 'FR-DSL-001: every op and every anchor suffix tokenizes', DSL],
  ['M12.9', 'FR-DSL-006: a malformed edge is a diagnostic with its column and a hint', DSL],
  ['M12.34', 'FR-DSL-006: edit distance counts insertions, deletions, substitutions and swaps of neighbours', DSL],
  ['M12.34', 'FR-DSL-006: toSlug turns a name into a valid slug, or nothing when no letter is left', DSL],
  ['M12.35', 'FR-DSL-006: nearest names the closest candidate within reach, the first by order on a tie, and nothing far off', DSL],
  ['M12.38', 'FR-DSL-001: empty values are null scalars with a place, and an empty file has no root content', DSL],
  ['M12.39', 'FR-DSL-002: meta, theme, screens, nodes, groups and edges read into a typed tree with their places', DSL],
  ['M12.39', 'FR-DSL-001: the documented checkout example reads with only FLX_DSL_NOT_YET warnings, its deferred sections kept by pointer', DSL],
  ['M12.39', 'FR-DSL-006: an unknown key is an error at its place with the nearest valid key', DSL],
  ['M12.39', 'FR-DSL-006: a missing or wrong version, a bad slug or screen id, and malformed values are diagnostics with their pointer', DSL],
  ['M12.40', 'FR-DSL-006: one problem is one diagnostic, and a preset with a name is refused (M12.39 review F2, F3)', DSL],
  ['M12.40', 'FR-DSL-001: every construct keeps the place it is written at (M12.39 review F1)', DSL],
  ['M12.10', 'FR-DSL-006: an unknown shape, slug or token is a diagnostic with line, column and a hint naming the nearest id', DSL],
  ['M12.11', 'FR-DSL-002: meta compiles to a document record with its title, theme and source (salt, deferred sections)', DSL],
  ['M12.11', 'FR-DSL-002: the theme compiles to a theme record named by the theme, with its token overrides applied', DSL],
  ['M12.11', 'FR-DSL-002: screens compile in order with their title, layout intent, background and notes', DSL],
  ['M12.11', 'FR-DSL-002: nodes compile to shape and text elements: slug, label as rich text, tone as variant, token styles, pins, alt', DSL],
  ['M12.11', 'FR-DSL-002: groups compile to group elements holding their members, with label, layout and style', DSL],
  ['M12.11', 'FR-DSL-002: edges compile to connectors and two bindings: markers and dashing by op, anchors, label, route, style', DSL],
  ['M12.11', 'FR-DSL-002: the checkout example compiles end to end (parse, read, resolve, expand) to a document that validates', DSL],
  ['M12.12', 'FR-DSL-005: stacked boxes never overlap and keep the gap, down from the padded top-left by default', 'layout'],
  ['M12.12', 'FR-DSL-005: the same input gives the same boxes, whatever the node order, and no placed box overlaps another', 'layout'],
  ['M12.13', 'FR-DSL-005: in a mixed fixture pinned boxes are exact and the others are placed without overlap', DSL],
  ['M12.14', 'FR-DSL-001: the checkout example compiles twice to byte-identical .flux.json, with only FLX_DSL_NOT_YET warnings', DSL],
  ['M12.14', 'FR-DSL-001: every record maps to a source range: its construct, else (a theme the file does not name) the whole file', DSL],
  ['M12.14', 'FR-DSL-006: a schema problem is a diagnostic at its source line, with the schema code and document pointer', DSL],
  ['M12.42', 'FR-DSL-006: a deck with many unfixable and many fixable errors validates a number of times linear in its errors', DSL],
  ['M12.43', 'FR-DSL-002: an edge drawn by hand is searched only among the edges joining its two ends, so hashes grow with the edges, not their square', DSL],
  ['M12.47', 'FR-DSL-001: ids come from the salt and hasher of the options; a base document kept salt wins (ADR-0031)', DSL],
];
leg('the compiler stages are tested under their requirement titles (T0)', () =>
  COMPILER_TITLES.length === 0 ? 'no compiler titles yet: the M12 rows add them' : titled(COMPILER_TITLES, EXACT),
);

// ── the file (FR-FIL-005) and the schema minor (ADR-0031) ─────────────────────────────────────────────
const FORMAT_TITLES = [
  ['M12.5', 'FR-DSL-005: a 1.2 document migrates to a valid 1.3 one and round-trips', 'schema'],
  ['M12.5', 'FR-DSL-005: a 1.2 document with non-conforming layout or source values migrates to a valid 1.3 one', 'schema'],
  ['M12.5', "FR-DSL-005: screen.layout and a group's and a frame's layout round-trip and must name a layout", 'schema'],
  ['M12.5', 'FR-DSL-002: document.source keeps its salt and deferred sections through a round trip', 'schema'],
  ['M12.28', 'FR-DSL-005: the 1.2 to 1.3 step keeps conforming layouts and sources beside the values it drops', 'schema'],
  ['M12.6', 'NFR-REL-005: SHA-256 matches the FIPS 180-4 vectors', 'core'],
  ['M12.6', 'FR-DSL-002: hash128 is the first 16 bytes of the SHA-256 of the UTF-8 text, and base62 writes 22 characters', 'core'],
  ['M12.6', 'FR-DSL-002: the same salt and key give the same id, which is a valid record id', 'core'],
  ['M12.6', 'FR-DSL-002: distinct slugs over a 10k corpus give distinct ids', 'core'],
  ['M12.15', 'FR-FIL-005: an identical document written twice gives byte-identical files, whatever its key order', 'format'],
  ['M12.15', 'FR-FIL-005: external assets are written beside the JSON by hash and read back', 'format'],
  ['M12.32', 'FR-FIL-005: an asset of a media type with no known extension, or a long one, keeps its file name through a round trip', 'format'],
  ['M12.33', 'FR-FIL-005: an extension the reader would not take back is not written, and a second write is the same bytes', 'format'],
];
leg('.flux.json is byte-deterministic and schema 1.3 (screen.layout, document.source) migrates from 1.2 (T0)', () =>
  FORMAT_TITLES.length === 0 ? 'no format titles yet: the M12 rows add them' : titled(FORMAT_TITLES, EXACT),
);

// ── streaming (FR-AI-010), grammars and completion (FR-DSL-009), the source view (FR-EDT-022) ─────────
const STREAM_TITLES = [
  ['M12.18', 'FR-AI-010: the checkout example splits into its header and four screens, each from its item line to the next item', DSL],
  ['M12.18', 'FR-AI-010: items at column 0, deep indents and CRLF line ends split the same way', DSL],
  ['M12.18', 'FR-AI-010: comments and blanks stay in the block they appear in, and a dashed line deeper than the item does not start a screen', DSL],
  ['M12.18', 'FR-AI-010: a top-level key after the screens is the tail, and the last screen ends before it', DSL],
  ['M12.18', 'FR-AI-010: a text with no screens key, or with the screens as a flow list, is all header', DSL],
  ['M12.18', 'FR-AI-010: fed line by line, a screen is emitted when the next item line is complete, never before, and the last one at end()', DSL],
  ['M12.18', 'FR-AI-010: a line is held back until its newline: single characters give the same pieces and nothing early', DSL],
  ['M12.18', 'FR-AI-010: blocks carry their offset and line in the whole input', DSL],
  ['M12.18', 'FR-AI-010: the header, the screens and the tail join back to the input, in any chunking, with every screen emitted once', DSL],
  ['M12.18', 'FR-AI-010: a splitter that has ended refuses more input', DSL],
  ['M12.18', 'FR-AI-010: fed line by line, each screen arrives when its block completes, in source order, and the result is the whole-file compile', DSL],
  ['M12.18', 'FR-AI-010: the checkout example streams its screens one update at a time, the last one at end()', DSL],
  ['M12.18', 'FR-AI-010: char by char and in random chunks give the same document and diagnostics as the whole file', DSL],
  ['M12.18', 'FR-AI-010: a screen with a syntax error reports its own diagnostics, and the screens after it still compile', DSL],
  ['M12.18', 'FR-AI-010: the header is compiled once, with its own diagnostics, and a block reports only its own', DSL],
  ['M12.18', 'FR-AI-010: a stream into a base document upserts its screens and keeps the rest of the base', DSL],
  [
    'M12.18',
    'FR-AI-010: with a base, an edited screen replaces its own records, keeps the ids of those that did not change, and leaves other screens byte-equal',
    DSL,
  ],
  ['M12.18', 'FR-AI-010: a node deleted from the text leaves with its connectors and bindings, and nothing dangles', DSL],
  ['M12.18', 'FR-AI-010: a screen block alone keeps the base title, theme, salt and header-level deferred sections, and replaces its own deferred ones', DSL],
  ['M12.18', 'FR-AI-010: a screen the base lacks is appended after the last, and a screen the text leaves out is kept', DSL],
  ['M12.18', 'FR-AI-010: compile without a base is unchanged, and the base itself is not mutated', DSL],
  ['M12.18', 'FR-AI-010: a text that does not parse leaves no document, and so nothing to merge', DSL],
  ['M12.18', 'FR-AI-010: uses, title and theme written after the screens give the whole-file document at end(), recompiled', DSL],
  ['M12.18', 'FR-AI-010: settings after the screens is a plain tail: no recompile, still the whole-file document', DSL],
  ['M12.18', 'FR-AI-010: a diagnostic without a source range is reported once in the whole stream, not once per screen', DSL],
];
leg('the streaming splitter never emits a half screen (T0)', () =>
  STREAM_TITLES.length === 0 ? 'no streaming titles yet: the M12 rows add them' : titled(STREAM_TITLES, EXACT),
);
// M12.20 writes the grammar tests in packages/editor/src/source-view/ (the node project; the language extension's in the browser project)
const GRAMMAR_TITLES = [
  ['M12.20', 'FR-DSL-009: the key table lists the compiled and deferred keys of every level, and no key is both', 'dsl'],
  ['M12.20', 'FR-DSL-009: the TextMate tokenization of checkout.flux.yaml matches its snapshot', 'editor'],
  ['M12.20', 'FR-DSL-009: the TextMate snapshot is stable: two tokenizations of every example give the same tokens', 'editor'],
  ['M12.20', 'FR-DSL-009: the grammar names the same keys and the same five edge ops as the compiler', 'editor'],
  ['M12.20', 'FR-DSL-009: the grammar file declares scope source.fluxscript and extends source.yaml', 'editor'],
  ['M12.20', 'FR-DSL-009: the TextMate grammar and the compiler tokenizer agree on every op, slug and anchor of every example', 'editor'],
  ['M12.20', 'FR-DSL-009: the Lezer YAML tree of every example has no error node', 'editor'],
  ['M12.20', 'FR-DSL-009: edge ops, slugs and anchors of the shorthand come from the compiler tokenizer', 'editor'],
  ['M12.20', 'FR-DSL-009: the five ops of edge-ops.flux.yaml are marked, in the shorthand and in the object form', 'editor'],
  ['M12.20', 'FR-DSL-009: an edge the compiler tokenizer refuses is left unmarked', 'editor'],
  ['M12.20', 'FR-DSL-009: keys are marked by level: compiled keys, deferred keys, and nothing for a name the table lacks', 'editor'],
  ['M12.20', 'FR-DSL-009: shape ids are split into pack and shape, and uses names the packs', 'editor'],
  ['M12.20', 'FR-DSL-009: checkout.flux.yaml marks its five edges and no range overlaps another', 'editor'],
  ['M12.20', 'FR-DSL-009: object-form ends are marked at their position inside the flow mapping', 'editor'],
  ['M12.20', 'FR-DSL-009: a document that is not a mapping, or is empty, has no tokens', 'editor'],
  ['M12.20', 'FR-DSL-009: the language is YAML with the FluxScript layer, which marks ops, slugs and anchors in a view', 'editor', {}, 'browser'],
  ['M12.20', 'FR-DSL-009: the marks follow an edit of the document', 'editor', {}, 'browser'],
];
leg('the TextMate and Lezer grammars exist and accept every example', () => {
  if (!exists('packages/dsl/grammar/fluxscript.tmLanguage.json')) return 'missing packages/dsl/grammar/fluxscript.tmLanguage.json';
  return GRAMMAR_TITLES.length === 0 ? 'no grammar titles yet: the M12 rows add them' : titled(GRAMMAR_TITLES, EXACT);
});
// M12.21 writes packages/editor/src/source-view/completion.browser.test.ts (ADR-0032) and adds its exact titles as browser-project entries:
// ['M12.21', '<exact title>', 'editor', {}, 'browser']
const COMPLETION_TITLES = [
  ['M12.21', 'FR-DSL-009: after shape: the list holds every registered basic shape and no shape of a pack that is not registered', 'editor', {}, 'browser'],
  ['M12.21', 'FR-DSL-009: token names after fill: are the theme tokens, narrowed by the prefix typed', 'editor', {}, 'browser'],
  ['M12.21', 'FR-DSL-009: after an edge op the list holds the slugs of the open screen and not those of another', 'editor', {}, 'browser'],
  ['M12.21', 'FR-DSL-009: after a slug and a dot the list holds the anchors', 'editor', {}, 'browser'],
];
leg('completion offers shape ids (packs included), token names and slugs in edges (T1 completion.browser.test.ts)', () =>
  COMPLETION_TITLES.length === 0 ? 'no completion titles yet: M12.21 adds them' : titled(COMPLETION_TITLES, EXACT),
);
// M12.22 writes packages/editor/src/source-view/source-sync.test.ts (node) and source-view.browser.test.tsx (browser project), FR-EDT-022
const SOURCE_VIEW_TITLES = [
  ['M12.22', 'FR-EDT-022: the source shown is the screen alone under the header, and the header ends at the screens line', 'editor'],
  ['M12.22', 'FR-EDT-022: an edit is compiled after 300 ms of quiet and the last of several edits wins', 'editor'],
  ['M12.22', 'FR-EDT-022: each apply is one undo step and undo restores the document before it', 'editor'],
  ['M12.22', 'FR-EDT-022: only the shown screen changes, and a text that changes nothing writes nothing', 'editor'],
  ['M12.22', 'FR-EDT-022: a text with an error applies nothing and reports its diagnostic at its line', 'editor'],
  ['M12.22', 'FR-EDT-022: the view shows the screen alone and a change of the header is refused', 'editor', {}, 'browser'],
  ['M12.22', 'FR-EDT-022: a valid edit reaches the canvas only after the debounce, as one undo step', 'editor', {}, 'browser'],
  ['M12.22', 'FR-EDT-022: an error marks its line in the gutter, lists it and leaves the canvas as it was', 'editor', {}, 'browser'],
  ['M12.22', 'FR-EDT-022: Escape hands the focus back to the host', 'editor', {}, 'browser'],
];
leg("the source view applies the author's edits to the canvas after a pause, one undo step each, and marks errors in the gutter (T0, T1)", () =>
  SOURCE_VIEW_TITLES.length === 0 ? 'no source view titles yet: M12.22 adds them' : titled(SOURCE_VIEW_TITLES, EXACT),
);
// rows whose T0 or T1 test another leg runs, so it is listed in no title list
const UNTITLED_ROWS = {
  'M12.16': 'the round-trip property leg runs roundtrip.prop.test.ts under ROUNDTRIP_TITLE and reads its numRuns',
  'M12.41': "a harness test of the budget gate (tests/harness/budget.test.mjs): node:test, run by pnpm verify's harness-tests step",
  'M12.50': "a harness test of vitestTitles (tests/harness/milestone-checks.test.mjs): node:test, run by pnpm verify's harness-tests step",
};
leg('every done M12 row whose acceptance names a T0 or T1 test has a title in a leg (or a reasoned exemption)', () =>
  checkRowsTitled(
    backlogTextFor('M12'),
    'M12',
    [COMPILER_TITLES, FORMAT_TITLES, STREAM_TITLES, GRAMMAR_TITLES, COMPLETION_TITLES, SOURCE_VIEW_TITLES],
    UNTITLED_ROWS,
  ),
);
leg('the studio renders a streamed source screen by screen and the source view syncs both ways (three engines)', () =>
  e2e(['e2e/dsl.streaming-render.spec.ts', 'e2e/source-view.two-way-sync.spec.ts'], DESKTOP),
);

// ── size and speed ────────────────────────────────────────────────────────────────────────────────────
leg(`size-limit: editor initial ≤ EDITOR_INITIAL_GZIP (${t('EDITOR_INITIAL_GZIP')}) and player core ≤ PLAYER_CORE_GZIP (${t('PLAYER_CORE_GZIP')})`, () => {
  const r = pnpm('exec', 'size-limit', '--json');
  const entries = r.status === 0 ? JSON.parse(r.stdout) : null;
  if (!entries) return `size-limit failed: ${ok(r)}`;
  const size = (name) => entries.find((e) => e.name === name)?.size;
  const editor = size('editor initial');
  const player = size('player core');
  if (editor === undefined || player === undefined) return 'size-limit lists no "editor initial" or "player core" entry';
  if (editor > t('EDITOR_INITIAL_GZIP')) return `editor initial ${editor} B > ${t('EDITOR_INITIAL_GZIP')}`;
  return player <= t('PLAYER_CORE_GZIP') || `player core ${player} B > ${t('PLAYER_CORE_GZIP')}`;
});
leg('CodeMirror and the DSL are not in the editor initial chunk or the player', () => {
  for (const f of ['packages/editor/dist/index.js', 'packages/player/dist/index.js']) {
    if (!exists(f)) return `missing ${f} (run the build)`;
    if (/@codemirror\/|@lezer\//.test(readText(f))) return `${f} holds CodeMirror or Lezer`;
  }
  return /@fluxion\/dsl/.test(readText('packages/player/dist/index.js')) ? 'the player bundle imports @fluxion/dsl' : true;
});
// DSL_COMPILE_10_MAX_MS (200 ms, M12.md row 18) is added to thresholds.mjs by M12.23, the row that writes the bench
leg('a 10-screen example compiles within DSL_COMPILE_10_MAX_MS (p99)', () =>
  'DSL_COMPILE_10_MAX_MS' in THRESHOLDS
    ? benchUnder('packages/dsl/bench/compile-10.bench.ts', 'compile-10', t('DSL_COMPILE_10_MAX_MS'))
    : 'no DSL_COMPILE_10_MAX_MS in thresholds.mjs yet (M12.23)',
);

// ── coverage, docs, changesets ──────────────────────────────────────────────────────────────────────
function coverageLeg(pkg, floors) {
  const out = mkdtempSync(join(tmpdir(), 'm12-cov-'));
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
leg('packages/dsl coverage at or above COVERAGE_PURE_LINES/BRANCHES', () =>
  coverageLeg(`packages/${DSL}`, { lines: t('COVERAGE_PURE_LINES'), branches: t('COVERAGE_PURE_BRANCHES') }),
);
const DIAGNOSTICS_PAGE = 'apps/docs/src/content/docs/reference/fluxscript-diagnostics.md';
const DSL_GUIDE = 'apps/docs/src/content/docs/guides/writing-fluxscript.md';
leg('docs: the diagnostics page lists every code in codes.ts, the "Writing FluxScript" guide, the dsl README and AGENTS.md, 06-ai-authoring.md', () => {
  for (const f of ['packages/dsl/src/diagnostics/codes.ts', DIAGNOSTICS_PAGE, DSL_GUIDE, 'packages/dsl/README.md', 'packages/dsl/AGENTS.md']) {
    if (!exists(f)) return `missing ${f}`;
  }
  const codes = [...new Set(readText('packages/dsl/src/diagnostics/codes.ts').match(/\bFLX_[A-Z0-9_]+\b/g) ?? [])];
  if (codes.length === 0) return 'codes.ts names no FLX_ code';
  const page = readText(DIAGNOSTICS_PAGE);
  const unlisted = codes.filter((c) => !page.includes(c));
  if (unlisted.length) return `${DIAGNOSTICS_PAGE} lacks ${unlisted.join(', ')}`;
  const checks = [
    [DSL_GUIDE, ['flux.yaml', 'screen', 'pin', 'diagnostic', 'Source view']],
    ['packages/dsl/README.md', ['compile', 'decompile', 'diagnostic', 'FLX_DSL_NOT_YET', 'stream']],
    ['packages/dsl/AGENTS.md', ['codes.ts', 'ADR-0030', 'compile']],
    ['docs/architecture/06-ai-authoring.md', ['compile', 'Source view', 'ADR-0030']],
  ];
  for (const [file, words] of checks) {
    const gaps = readmeGaps(readText(file), words);
    if (gaps !== true) return `${file}: ${gaps}`;
  }
  return true;
});
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M12\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M12 commits yet';
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
leg('no open test quarantines and no open spec folder for M12', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.includes('tests/harness/'));
  if (hits.length) return `open quarantines: ${hits.slice(0, 3).join(' | ')}`;
  const specs = exists('specs') ? listFiles('specs', (p) => /\/M12[^/]*\/tasks\.md$/.test(p)) : [];
  const open = specs.filter((p) => /^- \[ \]/m.test(readText(p)));
  return open.length === 0 || `open M12 spec tasks: ${open.join(', ')}`;
});
leg('CI green on ubuntu, windows and macos at or after the M12 final review range', () => {
  if (!exists('.harness/reviews/milestone-M12-final.json')) return 'no M12 final review yet: its range end is what the evidence must cover';
  return ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M12']));
});
leg('every M12 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M12'), 'M12', loadMilestoneReviews('M12')));
leg('final milestone review covers M12', () => {
  const rev = json('.harness/reviews/milestone-M12-final.json');
  return rev ? checkFinalReview(rev, 'M12') : 'missing .harness/reviews/milestone-M12-final.json';
});
leg('roadmap advanced past M12', () => !/^M(\d|1[012])$/.test(currentMilestone() ?? '') || `roadmap Current milestone is ${currentMilestone()}`);

await runLegs('m12');
