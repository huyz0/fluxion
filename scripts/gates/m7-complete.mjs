#!/usr/bin/env node
// Completion gate for M7 — Editing essentials: text, inspector, clipboard, commands
// (docs/milestones/M7.md). Written first and red (M7.1). Legs are behavioural: each runs the real
// test, spec or gate. The E2E groups and the performance legs are shared (editor-gate.mjs).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createE2e, DESKTOP, editorPerfLegs, MOBILE, PERF_GROUP } from './editor-gate.mjs';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
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
const RENDER = 'render';
const browser = (row, title, pkg = EDITOR) => [row, title, pkg, {}, 'browser'];

const { e2e, titledSpec, thresholdSpec } = createE2e({
  desktop: {
    projects: DESKTOP,
    specs: [
      'e2e/keymap.rebind.spec.ts',
      'e2e/undo.across-screens.spec.ts',
      'e2e/text.inline-edit.spec.ts',
      'e2e/text.markdown-shortcuts.spec.ts',
      'e2e/parity.edit-vs-present.spec.ts',
      'e2e/inspector.mixed-fill.spec.ts',
      'e2e/shapes.param-handle.spec.ts',
      ...['endpoint', 'midpoint', 'segment', 'curve'].map((h) => `e2e/connectors.${h}.spec.ts`),
      'e2e/clipboard.copy-paste.spec.ts',
      'e2e/clipboard.cross-document.spec.ts',
      'e2e/clipboard.system-paste.spec.ts',
      'e2e/context-menu.element.spec.ts',
      'e2e/validation.fix-broken-ref.spec.ts',
    ],
  },
  mobile: { projects: MOBILE, specs: ['e2e/context-menu.element.spec.ts'] },
  perf: PERF_GROUP,
});

leg('check-trace --milestone M7 green', () => ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M7'])));

// ── decisions (plan "Decide before coding") ─────────────────────────────────────────────────────────
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
leg('ADR-0064 rich-text editor library is accepted', () => adrLeg('ADR-0064', ['rich-text', 'editor']));
leg('ADR-0020 clipboard format is accepted', () => adrLeg('ADR-0020', ['clipboard']));

// ── keymap, screens, undo (plan rows 2, 14) ─────────────────────────────────────────────────────────
leg("the keymap binds every key once and absorbs M6's canvas keys (T0)", () =>
  titled([['M7.4', "FR-EDT-012: every default key has one binding, and M6's canvas keys resolve through the keymap", EDITOR]]),
);
leg('a rebinding persists and replaces the default (keymap.rebind)', () => e2e(['e2e/keymap.rebind.spec.ts'], DESKTOP));
leg('the Screens tab switches the shown screen (T1)', () => titled([browser('M7.6', 'FR-EDT-006: the Screens tab lists the screens and a click shows one')]));
leg("undo restores the edit's screen and selection (undo.across-screens)", () => e2e(['e2e/undo.across-screens.spec.ts'], DESKTOP));

// ── rich text (plan rows 3-7) ───────────────────────────────────────────────────────────────────────
/** One T1 golden per mark and per block (plan row 3), so a single mark cannot regress unseen. */
const MARKS = ['bold', 'italic', 'underline', 'strike', 'color', 'highlight', 'size', 'font', 'code', 'link'];
const BLOCKS = ['heading', 'bullet list', 'ordered list', 'nested list', 'alignment', 'spacing'];
leg('rich text: a golden per mark and block, links safe, kind text drawn, connector labels with marks (T1)', () =>
  titled([
    ...MARKS.map((m) => browser('M7.8', `FR-TXT-001: the ${m} mark matches its golden`, RENDER)),
    ...BLOCKS.map((b) => browser('M7.9', `FR-TXT-001: the ${b} block matches its golden`, RENDER)),
    browser('M7.8', 'FR-TXT-001: a javascript: link renders as plain text', RENDER),
    browser('M7.8', "FR-EDT-007: a kind 'text' element is drawn, not a placeholder", RENDER),
    browser('M7.9', 'FR-CON-006: a connector label renders its marks and links', RENDER),
  ]),
);
const MEASURE = 'FR-TXT-002: measured size equals rendered size ±1 px';
leg('both measurers agree with the rendered size within ±1 px (T0 and T1)', () => titled([['M7.10', MEASURE, RENDER], browser('M7.10', MEASURE, RENDER)]));
leg('inline editing; a grow shape grows in the same undo step (text.inline-edit)', () =>
  titledSpec('e2e/text.inline-edit.spec.ts', DESKTOP, ["FR-SHP-006: editing a grow shape's text grows it in the same undo step"]),
);
leg('Markdown input rules (text.markdown-shortcuts)', () => e2e(['e2e/text.markdown-shortcuts.spec.ts'], DESKTOP));
leg(`rich text draws the same pixels in edit and present within PARITY_MAX_DIFF_PCT (${t('PARITY_MAX_DIFF_PCT')} %)`, () =>
  thresholdSpec('e2e/parity.edit-vs-present.spec.ts', 'PARITY_MAX_DIFF_PCT', DESKTOP, [
    'FR-TXT-001: the rich-text fixture draws the same pixels in edit and present',
  ]),
);
/**
 * The first commit of `row`, whose parent is where the player size baseline is measured: M7.12 brings
 * the rich-text library, after M7.8-M7.10 legitimately grew the player's rendering (M7.1 review F1).
 */
const firstCommitOf = (row) =>
  run('git', ['rev-list', '--reverse', `--grep=^${row.replace('.', '\\.')}:`, 'HEAD'])
    .stdout.split(/\r?\n/)
    .find(Boolean);
leg('the rich-text library is in the editor bundle only: the player core is unchanged ±1 kB across M7.12', () => {
  const base = json('.harness/baselines/m7-player-size.json');
  if (!base) return 'missing .harness/baselines/m7-player-size.json (M7.12 measures it at its parent commit)';
  const first = firstCommitOf('M7.12');
  if (!first) return 'no M7.12 commit yet';
  const parent = run('git', ['rev-parse', '--short', `${first}~1`]).stdout.trim();
  if (!parent || !String(base.measuredAt).startsWith(parent)) return `the baseline was measured at ${base.measuredAt}, not at M7.12's parent ${parent}`;
  const built = pnpm('run', 'build');
  if (built.status !== 0) return `build failed: ${ok(built)}`;
  const r = pnpm('exec', 'size-limit', '--json');
  let sizes;
  try {
    sizes = JSON.parse(r.stdout);
  } catch {
    return `size-limit printed no JSON: ${ok(r)}`;
  }
  const player = sizes.find((s) => s.name === 'player core')?.size;
  if (typeof player !== 'number') return 'size-limit has no player core entry';
  if (Math.abs(player - base.playerCoreGzip) > 1000) return `player core ${player} B gzip, baseline ${base.playerCoreGzip} B (±1000)`;
  const libs = ['prosemirror', 'lexical', '@tiptap'];
  const hasLib = (p) => Object.keys(json(p)?.dependencies ?? {}).some((d) => libs.some((l) => d.includes(l)));
  const manifests = run('git', ['ls-files', 'packages/*/package.json']).stdout.split(/\r?\n/).filter(Boolean);
  const outside = manifests.filter((m) => m !== 'packages/editor/package.json' && hasLib(m));
  if (!hasLib('packages/editor/package.json')) return 'the rich-text library is not an editor dependency';
  return outside.length === 0 || `the rich-text library is a dependency of ${outside.join(', ')}`;
});

// ── inspector and handles (plan rows 8-10) ──────────────────────────────────────────────────────────
leg('the inspector intersects a multi-selection; a mixed apply is one undo step (T0, T1)', () =>
  titled([
    ['M7.15', "FR-EDT-008: a multi-selection's inspector shows the fields they share, mixed where they differ", EDITOR],
    browser('M7.16', 'FR-EDT-008: a mixed fill set on 3 shapes updates all 3 in one undo step'),
  ]),
);
leg('a mixed fill on 3 shapes (inspector.mixed-fill)', () => e2e(['e2e/inspector.mixed-fill.spec.ts'], DESKTOP));
leg('a parametric handle changes its param in one undo step (shapes.param-handle)', () => e2e(['e2e/shapes.param-handle.spec.ts'], DESKTOP));
leg('connector handles: ends, middle, segments, curves; selection chrome along the route (connectors.<handle>)', () => {
  const chrome = titledSpec('e2e/connectors.endpoint.spec.ts', DESKTOP, ['FR-CON-007: a selected connector shows selection chrome along its route']);
  return chrome === true
    ? e2e(
        ['midpoint', 'segment', 'curve'].map((h) => `e2e/connectors.${h}.spec.ts`),
        DESKTOP,
      )
    : chrome;
});

// ── clipboard (plan rows 11-12) ─────────────────────────────────────────────────────────────────────
leg('paste keeps bindings among copied elements with fresh ids (T0; clipboard.copy-paste)', () => {
  const unit = titled([['M7.21', 'FR-EDT-007: a pasted connector stays bound to the pasted shapes, all with fresh ids', EDITOR]]);
  return unit === true ? e2e(['e2e/clipboard.copy-paste.spec.ts'], DESKTOP) : unit;
});
leg('a copy pastes into another document, bindings kept (clipboard.cross-document)', () => e2e(['e2e/clipboard.cross-document.spec.ts'], DESKTOP));
leg('system paste: SVG is sanitised (the security subset), images and text land (T0; clipboard.system-paste)', () => {
  const unit = titled([['M7.23', 'NFR-SEC-001: pasted SVG loses its scripts and event handlers', 'format']]);
  return unit === true ? e2e(['e2e/clipboard.system-paste.spec.ts'], DESKTOP) : unit;
});

// ── commands, menus, validation (plan rows 13, 15, 16) ──────────────────────────────────────────────
leg('the palette lists every registered command (T1)', () => titled([browser('M7.24', 'FR-EDT-011: every registered command appears')]));
leg('context menus with select same type and style, desktop and touch (context-menu.element)', () => {
  const desktop = e2e(['e2e/context-menu.element.spec.ts'], DESKTOP);
  return desktop === true ? e2e(['e2e/context-menu.element.spec.ts'], MOBILE) : desktop;
});
leg('the validation panel lists a dangling binding and fixes it (validation.fix-broken-ref)', () => e2e(['e2e/validation.fix-broken-ref.spec.ts'], DESKTOP));

// ── performance, shared with every editor gate (M6 final F4) ────────────────────────────────────────
editorPerfLegs(leg, { thresholdSpec });

// ── coverage, docs and changesets (plan row 17) ─────────────────────────────────────────────────────
leg('packages/editor coverage at or above COVERAGE_EDITOR_LINES/BRANCHES', () => {
  const out = mkdtempSync(join(tmpdir(), 'm7-cov-'));
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
leg('docs: Editing text and Keyboard shortcuts guides (generated from the keymap), inspector stories', () => {
  const guides = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'apps/docs']).stdout.split(/\r?\n/);
  const text = guides.find((f) => /editing-text\.mdx?$/.test(f));
  if (!text) return 'no apps/docs editing-text guide';
  const gaps = [];
  const g = readmeGaps(readText(text), ['Enter', 'Esc', 'Ctrl+B', '# ', '**']);
  if (g !== true) gaps.push(`${text}: ${g}`);
  if (!exists('scripts/docs/keyboard-shortcuts.mjs')) gaps.push('no scripts/docs/keyboard-shortcuts.mjs (the guide generated from the keymap)');
  else {
    const check = ok(node('scripts/docs/keyboard-shortcuts.mjs', ['--check']));
    if (check !== true) gaps.push(`keyboard shortcuts guide: ${check}`);
  }
  const stories = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'packages/editor/src'])
    .stdout.split(/\r?\n/)
    .filter((f) => f.endsWith('.stories.tsx'));
  if (!stories.some((f) => f.toLowerCase().includes('inspector'))) gaps.push('no inspector story in packages/editor/src');
  return gaps.length === 0 || gaps.join('; ');
});
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M7\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M7 commits yet';
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
leg('CI green on ubuntu, windows and macos, visual job included, at or after the M7 final review range', () => {
  if (!exists('.harness/reviews/milestone-M7-final.json')) return 'no M7 final review yet: its range end is what the evidence must cover';
  const unit = namedCases('tests/harness/ci-evidence.test.mjs', ['evidence without a green visual job fails']);
  return unit === true ? ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M7'])) : unit;
});
leg('every M7 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M7'), 'M7', loadMilestoneReviews('M7')));
leg('final milestone review covers M7', () => {
  const rev = json('.harness/reviews/milestone-M7-final.json');
  return rev ? checkFinalReview(rev, 'M7') : 'missing .harness/reviews/milestone-M7-final.json';
});
leg(
  'roadmap advanced past M7',
  () => !['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'].includes(currentMilestone()) || `roadmap Current milestone is ${currentMilestone()}`,
);

await runLegs('m7');
