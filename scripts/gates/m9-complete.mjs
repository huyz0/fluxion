#!/usr/bin/env node
// Completion gate for M9 — Theme & fonts v1 (docs/milestones/M9.md). Written first and red (M9.1). Legs are behavioural:
// each runs the real test, spec, bench or gate. The E2E groups and the performance legs are shared with the other editor
// gates (editor-gate.mjs).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createE2e, DESKTOP, editorPerfLegs, PERF_GROUP } from './editor-gate.mjs';
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
const CORE = 'core';
const THEME = 'theme';
const SCHEMA = 'schema';
const EDITOR = 'editor';
const browser = (row, title, pkg = EDITOR) => [row, title, pkg, {}, 'browser'];
const GUIDE = 'apps/docs/src/content/docs/guides/themes-and-fonts.md';
const CHECKLIST = 'docs/a11y/editor-checklist.md';

const VISUAL = ['chromium'];
const { e2e, titledSpec, thresholdSpec } = createE2e({
  desktop: {
    projects: DESKTOP,
    specs: [
      'e2e/theme.switch-and-override.spec.ts',
      'e2e/fonts.google.spec.ts',
      'e2e/fonts.picker.spec.ts',
      'e2e/document.metadata.spec.ts',
      'e2e/a11y.editor.spec.ts',
    ],
  },
  visual: { projects: VISUAL, specs: ['e2e/theme.snapshots.spec.ts'] },
  perf: PERF_GROUP,
});

leg('check-trace --milestone M9 green', () => ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M9'])));

// ── decisions ───────────────────────────────────────────────────────────────────────────────────────
const DECISIONS = 'docs/architecture/decisions';
function adrLeg(num, words, also) {
  return () => {
    const file = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', DECISIONS])
      .stdout.split(/\r?\n/)
      .find((f) => f.startsWith(`${DECISIONS}/ADR-${num}-`));
    if (!file) return `no ADR-${num} in ${DECISIONS}`;
    const text = readText(file);
    const title = (/^# .*$/m.exec(text)?.[0] ?? '').toLowerCase();
    if (!words.every((w) => title.includes(w))) return `${file}: title does not name ${words.join(', ')}`;
    const missing = also.filter((w) => !new RegExp(w, 'i').test(text));
    if (missing.length) return `${file} does not mention ${missing.join(', ')}`;
    return /^status:\s*accepted\s*$/m.test(text) || `${file} is not accepted`;
  };
}
leg('ADR-0022 font sourcing and licensing is accepted', adrLeg('0022', ['font'], ['OFL', 'allowlist', 'Google Fonts', 'upload', 'M10']));
leg('ADR-0023 the i18n pipeline is accepted', adrLeg('0023', ['i18n'], ['Lingui', 'locales', 'ICU', 'allowlist']));
leg('ADR-0152 the token model and schema 1.2 is accepted', adrLeg('0152', ['token'], ['OKLCH', 'culori', '1\\.2', 'metadata']));

// ── schema 1.2: document metadata (FR-DOC-006) ──────────────────────────────────────────────────────
leg('a 1.1 document migrates to 1.2 and a document with metadata round-trips (T0)', () =>
  titled([
    ['M9.5', 'FR-DOC-006: a 1.1 document migrates to 1.2 and round-trips', SCHEMA],
    ['M9.5', 'FR-DOC-006: a document with description, tags and custom key-values round-trips', SCHEMA],
    ['M9.5', 'FR-DOC-006: a 1.1 document with non-conforming new fields migrates to a valid 1.2 one', SCHEMA],
    ['M9.5', "FR-THM-004: a screen's theme reference round-trips and must name a theme record", SCHEMA],
  ]),
);

// ── tokens, derived tokens, the eight themes (FR-THM-001..003) ──────────────────────────────────────
leg('the light theme validates against the full token schema; a missing role names its path (T0)', () =>
  titled([
    ['M9.6', 'FR-THM-001: the built-in light theme validates against the full token schema', THEME],
    ['M9.6', 'FR-THM-001: a missing role is a diagnostic naming its path', THEME],
  ]),
);
leg('derived tokens match the reference OKLCH values and follow their source (T0)', () =>
  titled([
    ['M9.7', 'FR-THM-002: a derived token lightened by 20 percent in OKLCH matches the reference values within 1e-3', THEME],
    ['M9.7', 'FR-THM-002: a derived token follows its source token when the theme changes', THEME],
    ['M9.7', 'FR-THM-002: a theme with a cycle is reported as FLX_TOKEN_CYCLE and does not loop', THEME],
  ]),
);
leg('the pack lists eight themes, each valid, and every pair meets WCAG AA (T0)', () =>
  titled([
    ['M9.8', 'FR-THM-003: the pack lists the eight built-in themes', 'packs/themes-core'],
    ['M9.8', 'FR-THM-001: every theme in the pack validates against the full token schema', 'packs/themes-core'],
    ['M9.8', "FR-THM-003: every theme's text and background role pairs meet WCAG AA 4.5:1", 'packs/themes-core'],
  ]),
);
leg('a theme switch is one undo step, an override keeps its values, metadata updates through the clock (T0)', () =>
  titled([
    ['M9.9', 'FR-THM-004: switching the theme is one undo step and restyles every screen', CORE],
    ['M9.9', 'FR-THM-004: a screen with an override keeps its own values', CORE],
    ['M9.9', 'FR-DOC-006: updating metadata sets modified through the clock and is one undo step', CORE],
  ]),
);
leg('the theme switcher recolours every screen and keeps an override (theme.switch-and-override)', () =>
  titledSpec('e2e/theme.switch-and-override.spec.ts', DESKTOP, [
    'FR-THM-004: switching the theme recolours every screen and one undo restores it',
    'FR-THM-004: a screen override survives a document theme switch',
  ]),
);
leg('the reference document matches its snapshot in each of the eight themes (theme.snapshots)', () =>
  titledSpec('e2e/theme.snapshots.spec.ts', VISUAL, ['FR-THM-003: the reference document matches its snapshot in each of the eight themes']),
);

// ── fonts (FR-THM-008) ──────────────────────────────────────────────────────────────────────────────
leg('a loaded font changes the measured width and is in the cache key (T1)', () =>
  titled([browser('M9.12', 'FR-THM-008: after the font loads, the measured width changes and the cache key includes the font')]),
);
leg('fonts pass the font-licence allowlist and others fail it (T0)', () =>
  namedCases('tests/harness/licenses.test.mjs', ['FR-THM-008: a font under OFL-1.1 passes the font allowlist and one under another licence fails']),
);
leg('a document in a bundled font measures within 1 px on the metrics path (T1)', () =>
  titled([browser('M9.14', 'FR-THM-008: a document in a bundled font measures within 1 px on the metrics path')]),
);
leg('a Google font renders offline from the mocked route and the player names no Google Fonts URL', () => {
  const unit = titled([['M9.15', 'FR-THM-008: a fetched Google font gets a metrics record', 'apps/studio', {}, 'browser']]);
  if (unit !== true) return unit;
  const grep = namedCases('tests/harness/google-fonts.test.mjs', ['FR-THM-008: the player bundle names no Google Fonts URL']);
  // the mocked-route spec drives the picker (M9.17), where the picked font is applied to text
  return grep === true ? titledSpec('e2e/fonts.google.spec.ts', DESKTOP, ['FR-THM-008: the picked Google font renders']) : grep;
});
leg('a non-font is rejected and an uploaded font gets a metrics record (T0)', () =>
  titled([
    ['M9.16', 'FR-THM-008: bytes that are not a font are rejected with a diagnostic', 'theme'],
    browser('M9.16', 'FR-THM-008: an uploaded font gets a metrics record'),
  ]),
);
leg('the font picker applies a font from each source (fonts.picker)', () =>
  titledSpec('e2e/fonts.picker.spec.ts', DESKTOP, ['FR-THM-008: a font picked from each source applies to the selected text']),
);

// ── metadata (FR-DOC-006) ───────────────────────────────────────────────────────────────────────────
leg('edited metadata survives a reload (document.metadata)', () =>
  titledSpec('e2e/document.metadata.spec.ts', DESKTOP, ['FR-DOC-006: edited metadata survives a reload']),
);

// ── i18n and accessibility (NFR-I18N-001, NFR-A11Y-001) ─────────────────────────────────────────────
leg('a JSX string literal outside the allowlist fails check-i18n, and the repository passes it', () => {
  const unit = namedCases('tests/harness/check-i18n.test.mjs', ['NFR-I18N-001: a JSX string literal outside the allowlist fails check-i18n']);
  if (unit !== true) return unit;
  if (!exists('scripts/gates/check-i18n.mjs')) return 'missing scripts/gates/check-i18n.mjs';
  return ok(node('scripts/gates/check-i18n.mjs', []));
});
leg('pnpm i18n:extract --check: the catalogs are in sync with the source', () => ok(pnpm('i18n:extract', '--check')));
leg('the editor renders its English messages (T1)', () => titled([browser('M9.20', 'NFR-I18N-001: the editor renders its English messages')]));
leg('the editor has no serious or critical axe finding in any state, on three engines (a11y.editor)', () =>
  titledSpec('e2e/a11y.editor.spec.ts', DESKTOP, ['NFR-A11Y-001: the editor has no serious or critical axe finding in any state']),
);
leg('every story passes axe, and the M9 UI has its stories (ADR-0139 portable stories)', () => {
  const missing = ['theme-switcher', 'font-picker', 'metadata-dialog'].map((n) => `packages/editor/src/${n}.stories.tsx`).filter((f) => !exists(f));
  if (missing.length) return `missing ${missing.join(', ')}`;
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'packages/editor/src'])
    .stdout.split(/\r?\n/)
    .filter((f) => f.endsWith('.stories.browser.test.tsx'));
  if (files.length === 0) return 'no portable-story tests';
  return ok(pnpm('exec', 'vitest', 'run', '--project', 'browser', ...files));
});
leg('the editor accessibility checklist exists', () => {
  if (!exists(CHECKLIST)) return `missing ${CHECKLIST}`;
  return readmeGaps(readText(CHECKLIST), ['keyboard', 'focus', 'contrast', 'label']);
});

// ── performance (the editor gates rerun them) ───────────────────────────────────────────────────────
editorPerfLegs(leg, { thresholdSpec });

function coverageLeg(pkg, floors) {
  const out = mkdtempSync(join(tmpdir(), 'm9-cov-'));
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
leg('packages/theme coverage at or above COVERAGE_PURE_LINES/BRANCHES', () =>
  coverageLeg('packages/theme', { lines: t('COVERAGE_PURE_LINES'), branches: t('COVERAGE_PURE_BRANCHES') }),
);
leg('docs: the "Themes & fonts" guide', () => {
  if (!exists(GUIDE)) return `missing ${GUIDE}`;
  return readmeGaps(readText(GUIDE), ['theme', 'token', 'font', 'override', 'metadata']);
});
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M9\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M9 commits yet';
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
leg('CI green on ubuntu, windows and macos, visual job included, at or after the M9 final review range', () => {
  if (!exists('.harness/reviews/milestone-M9-final.json')) return 'no M9 final review yet: its range end is what the evidence must cover';
  const unit = namedCases('tests/harness/ci-evidence.test.mjs', ['evidence without a green visual job fails']);
  return unit === true ? ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M9'])) : unit;
});
leg('every M9 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M9'), 'M9', loadMilestoneReviews('M9')));
leg('final milestone review covers M9', () => {
  const rev = json('.harness/reviews/milestone-M9-final.json');
  return rev ? checkFinalReview(rev, 'M9') : 'missing .harness/reviews/milestone-M9-final.json';
});
leg(
  'roadmap advanced past M9',
  () => !['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'].includes(currentMilestone()) || `roadmap Current milestone is ${currentMilestone()}`,
);

await runLegs('m9');
