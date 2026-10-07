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
const ROUNDTRIP = 'packages/dsl/src/roundtrip.prop.test.ts';

const { e2e } = createE2e({
  desktop: { projects: DESKTOP, specs: ['e2e/source-view.two-way-sync.spec.ts', 'e2e/dsl.streaming-render.spec.ts'] },
});

leg('check-trace --milestone M12 green', () => ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M12'])));

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
  const runs = propertyRuns(readText(ROUNDTRIP), 'FR-DSL-002');
  return !Number.isNaN(runs) || `${ROUNDTRIP}: numRuns is computed and cannot be read: use a number or a constant`;
});
// the rows that write these tests add their exact titles (parse ranges, diagnostics with hints, placement, determinism)
const COMPILER_TITLES = [];
leg('the compiler stages are tested under their requirement titles (T0)', () =>
  COMPILER_TITLES.length === 0 ? 'no compiler titles yet: the M12 rows add them' : titled(COMPILER_TITLES),
);

// ── the file (FR-FIL-005) and the schema minor (ADR-0031) ─────────────────────────────────────────────
const FORMAT_TITLES = [];
leg('.flux.json is byte-deterministic and schema 1.3 (screen.layout, document.source) migrates from 1.2 (T0)', () =>
  FORMAT_TITLES.length === 0 ? 'no format titles yet: the M12 rows add them' : titled(FORMAT_TITLES),
);

// ── streaming (FR-AI-010), grammars and completion (FR-DSL-009), the source view (FR-EDT-022) ─────────
const STREAM_TITLES = [];
leg('the streaming splitter never emits a half screen (T0)', () =>
  STREAM_TITLES.length === 0 ? 'no streaming titles yet: the M12 rows add them' : titled(STREAM_TITLES),
);
const GRAMMAR_TITLES = [];
leg('the TextMate and Lezer grammars exist and accept every example', () => {
  if (!exists('packages/dsl/grammar/fluxscript.tmLanguage.json')) return 'missing packages/dsl/grammar/fluxscript.tmLanguage.json';
  return GRAMMAR_TITLES.length === 0 ? 'no grammar titles yet: the M12 rows add them' : titled(GRAMMAR_TITLES);
});
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
