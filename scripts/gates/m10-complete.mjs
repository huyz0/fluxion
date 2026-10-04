#!/usr/bin/env node
// Completion gate for M10 — File format & persistence (docs/milestones/M10.md). Written first and red (M10.1). Legs are behavioural:
// each runs the real test, spec, fuzz, corpus or gate. M10 started on the human's instruction while M9's rows M9.11, M9.19, M9.20,
// M9.23 and M9.28 are blocked (docs/backlog/current.md), so this gate does not wait for M9 to close.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createE2e, DESKTOP } from './editor-gate.mjs';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  changesetsCoverRange,
  checkBacklogDone,
  checkFinalReview,
  coverageGaps,
  loadMilestoneReviews,
  namedCases,
  propertyRuns,
  readmeGaps,
  titled,
  verifyLeg,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const pnpm = (...a) => run('pnpm', a);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);
const FORMAT = 'format';

/** Test files (Vitest T0) of the workspaces under `roots`, tracked or new. */
function testFiles(roots) {
  const r = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...roots]);
  return r.stdout.split(/\r?\n/).filter((f) => /\/src\/.*\.test\.[cm]?[jt]sx?$/.test(f));
}

const STUDIO = 'apps/studio';
const EDITOR = 'editor';
const GUIDE = 'apps/docs/src/content/docs/guides/saving-and-opening.md';

const { titledSpec } = createE2e({
  desktop: {
    projects: DESKTOP,
    specs: [
      'e2e/file.offline-file-protocol.spec.ts',
      'e2e/file.open-save.spec.ts',
      'e2e/file.open-url.spec.ts',
      'e2e/file.autosave-status.spec.ts',
      'e2e/file.embedded-font.spec.ts',
      'e2e/file.crash-recovery.spec.ts',
      'e2e/file.library.spec.ts',
      'e2e/assets.remove-unused.spec.ts',
      'e2e/file.fidelity.spec.ts',
    ],
  },
});

leg('check-trace --milestone M10 green', () => ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M10'])));

// ── decisions ────────────────────────────────────────────────────────────
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
// the ADR's title names the three containers, not the words 'file format': the leg checks it is accepted, amended for M10 and names the parts
leg(
  'ADR-0003 the file format is accepted and reconciled with M10',
  adrLeg('0003', [], ['mimetype', 'manifest', 'CSP', 'Amendments', 'classic inline script', 'fluxion convert']),
);
leg('ADR-0024 autosave storage is accepted', adrLeg('0024', ['autosave'], ['IndexedDB', 'OPFS', 'Web Locks', 'quota']));
leg('ADR-0025 the sanitizer and image encoding is accepted', adrLeg('0025', ['sanitizer'], ['allowlist', 'WebP', 'AVIF', 'XML parser']));

// ── the container (FR-FIL-003, FR-FIL-004) ──────────────────────────────────────────────────────────
leg('the zip codec round-trips, reads what zlib wrote, pins its container bytes and refuses broken input (T0)', () =>
  titled([
    ['M10.23', 'FR-FIL-003: deflate then inflate returns the bytes, for empty, tiny, repetitive, long and random inputs', FORMAT],
    ['M10.23', 'FR-FIL-003: inflate reads fixed, stored and dynamic blocks written by zlib', FORMAT],
    ['M10.23', 'FR-FIL-003: a one-entry zip has exactly these bytes (the container is pinned, and Python zipfile accepted it)', FORMAT],
    ['M10.23', 'NFR-REL-002: inflate refuses broken streams with a reason and never throws', FORMAT],
    ['M10.23', 'NFR-REL-002: readZip never throws on truncated, corrupted or hostile bytes', FORMAT],
    ['M10.23', 'FR-FIL-009: readZip refuses what exceeds its limits and says which', FORMAT],
  ]),
);
leg('the same document written twice gives byte-identical .flux files (T0)', () =>
  titled([['M10.4', 'FR-FIL-003: the same document written twice gives byte-identical .flux files', FORMAT]]),
);
leg('duplicating an image 10 times adds under 1 kB and only referenced assets are saved (T0)', () =>
  titled([
    ['M10.5', 'FR-FIL-004: duplicating an image 10 times adds less than 1 kB', FORMAT],
    ['M10.5', 'FR-FIL-004: an asset no record refers to is not saved', FORMAT],
  ]),
);
const FUZZ = 'NFR-REL-002: the loader never throws on a corrupted zip (10000 runs)';
leg('the loader never throws on corrupted zips, 10 000 fast-check runs (T0)', () => {
  // the plan's 10 000 runs, not fast-check's default 200
  const file = testFiles(['packages/format']).find((p) => readText(p).includes(FUZZ));
  if (file === undefined) return `no format test titled "${FUZZ}"`;
  const runs = propertyRuns(readText(file), FUZZ);
  if (Number.isNaN(runs)) return `${file}: the property's numRuns is computed and cannot be read: use a number or a constant`;
  if (runs < 10_000) return `${file}: the property runs ${runs || "the runner's default 200"} times (< 10 000)`;
  return titled([['M10.6', FUZZ, FORMAT]]);
});
leg('the loader refuses hostile archives: zip bombs, "..", absolute and duplicate paths (T0)', () =>
  titled([
    ['M10.6', 'FR-FIL-009: an archive over the expansion limit is refused, not unpacked', FORMAT],
    ['M10.6', 'FR-FIL-009: entries with .., absolute or duplicate paths are refused', FORMAT],
  ]),
);
leg('a truncated document keeps its valid screens and lists what was dropped; a newer major opens read-only (T0)', () =>
  titled([
    ['M10.7', 'FR-FIL-009: a truncated document.json loads its valid screens and lists the dropped records', FORMAT],
    ['M10.7', 'NFR-PORT-003: a file of a newer major version opens read-only', FORMAT],
  ]),
);
leg('unknown entries and fields survive a re-save, and every v1.0 golden round-trips byte-identically (T0)', () =>
  titled([
    ['M10.8', 'NFR-PORT-003: unknown entries and unknown fields survive a re-save', FORMAT],
    ['M10.8', 'NFR-PORT-003: every v1.0 golden loads, migrates and round-trips byte-identically', FORMAT],
  ]),
);

// ── security (NFR-SEC-001, NFR-SEC-002) ─────────────────────────────────────────────────────────────
leg('every case of the security corpus: nothing executes, no request leaves, the output is sanitized (T0)', () =>
  titled([
    ['M10.9', 'NFR-SEC-001: every case of the security corpus is neutralised through load, render, save and reload', FORMAT],
    ['M10.9', 'NFR-SEC-001: the sanitizer gives the same output in Node and in the browser', FORMAT],
  ]),
);
leg('the sources use no eval or new Function', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', '\\beval\\(|new Function\\(', '--', 'packages/*/src', 'apps/studio/src', 'packs']);
  const hits = r.stdout.split(/\r?\n/).filter(Boolean);
  return hits.length === 0 || `eval or new Function: ${hits.slice(0, 3).join(' | ')}`;
});

// ── the single file (FR-FIL-002, FR-EXP-001, FR-FIL-003) ────────────────────────────────────────────
leg('the inline player bundle is built and size-limit runs its player-inline entry', () => {
  if (!exists('packages/player-inline/dist/player.inline.js')) return 'missing packages/player-inline/dist/player.inline.js (run the build)';
  const r = pnpm('exec', 'size-limit', '--json');
  const entries = r.status === 0 ? JSON.parse(r.stdout) : [];
  const entry = entries.find((e) => String(e.name).includes('player-inline'));
  return entry === undefined ? `size-limit lists no player-inline entry: ${ok(r)}` : entry.size > 0 || 'the player-inline entry measures 0 bytes';
});
leg('the one-file player script opens a .flux, draws it with the bundled shapes, moves with the arrow keys, and holds no eval or network (T1)', () =>
  titled([
    [
      'M10.10',
      'FR-FIL-002: the script defines Fluxion.start, which opens a .flux, draws its first screen with the bundled shapes, and the arrow keys move through the screens',
      'player-inline',
      {},
      'browser',
    ],
    [
      'M10.10',
      'FR-FIL-002: an image of the file is drawn from a blob URL made from its own verified bytes, and is released on unmount',
      'player-inline',
      {},
      'browser',
    ],
    ['M10.10', 'FR-FIL-002: a file that cannot be opened is a message in the page, not an exception', 'player-inline', {}, 'browser'],
    ['M10.10', 'FR-EXP-001: the script holds nothing that evaluates text, loads code or reaches the network', 'player-inline', {}, 'browser'],
    [
      'M10.10',
      'FR-FIL-002: the deck shows the first visible screen, and the arrow keys move through the visible screens, stopping at the ends',
      'player',
      {},
      'browser',
    ],
  ]),
);
leg('a .flux.html names both re-import markers in its first 4 kB and one CSP meta with connect-src none (T0)', () =>
  titled([
    ['M10.11', 'FR-FIL-002: both re-import markers are in the first 4 kB of a .flux.html', FORMAT],
    ['M10.11', "NFR-SEC-002: a .flux.html has one CSP meta with connect-src 'none' and the hashes of its scripts", FORMAT],
  ]),
);
leg('.flux and .flux.html convert into each other losslessly, and the reader never runs a script (T0)', () =>
  titled([
    ['M10.12', 'FR-FIL-003: .flux and .flux.html convert into each other losslessly', FORMAT],
    ['M10.12', 'FR-FIL-002: reading a .flux.html does not run its scripts', FORMAT],
  ]),
);
leg('a .flux.html opens from file:// offline on three engines with no external request and a planted fetch blocked', () =>
  titledSpec('e2e/file.offline-file-protocol.spec.ts', DESKTOP, [
    'NFR-SEC-002: the CSP stops a planted fetch, a planted script and a planted frame, and says so',
    'FR-FIL-001, NFR-PORT-002: the file opens with no network and draws its first screen, with 0 external requests',
    'NFR-PORT-002: the same file opens from a static host over http, asking for nothing but itself',
  ]),
);

// ── assets (FR-AST-001, FR-AST-002, FR-AST-005, NFR-SIZE-004) ───────────────────────────────────────
leg('images are sniffed by magic bytes and a 4000 px JPEG imports as a WebP of at most 2560 px (T1)', () =>
  titled([
    ['M10.14', 'FR-AST-001: a PNG is known by its signature, with its size, whatever it is named', FORMAT],
    ['M10.14', 'FR-AST-001: a JPEG is known by its start of image, with the size from its first frame marker', FORMAT],
    ['M10.14', 'FR-AST-001: WebP in its three forms: lossy, lossless and extended (animated by its flag)', FORMAT],
    ['M10.14', 'FR-AST-001: SVG is text that starts as SVG, after a BOM, a prolog, a doctype or a comment; other text is not an image', FORMAT],
    ['M10.14', 'FR-AST-002: a 4000 px JPEG imports as a WebP of at most 2560 px', EDITOR, {}, 'browser'],
  ]),
);
// the embedded shape-defs list is M10.57 (blocked: a manifest contract with no consumer yet); the fonts are checked here
leg('embedded fonts equal the referenced ones, with their licence lines (T0)', () =>
  titled([
    ['M10.15', 'NFR-SIZE-004: a family the text names is embedded as well, and one nothing names is not', STUDIO],
    ['M10.15', 'NFR-LIC-003: a saved font carries its copyright line and licence in the file, and an unused font is not in it', FORMAT],
  ]),
);
leg('the asset manager removes only unreferenced assets (assets.remove-unused)', () =>
  titledSpec('e2e/assets.remove-unused.spec.ts', DESKTOP, [
    'FR-AST-005: Remove unused deletes only the assets nothing references, and one undo brings them back',
  ]),
);

// ── the studio: open, save, autosave, library (FR-FIL-006..008, NFR-REL-001) ────────────────────────
leg('open by picker, drop, ?src= and paste; save atomically on chromium and by download elsewhere (file.open-save, file.open-url)', () => {
  const saved = titledSpec('e2e/file.open-save.spec.ts', DESKTOP, [
    'FR-FIL-006: a .flux opens from the picker, an edit is saved over the same file through its handle, and the saved file has the edit',
    'FR-FIL-006: a file dropped on the page opens',
    'FR-FIL-006: without the File System Access API a file is picked with an input and a save is a download',
  ]);
  const urls = titledSpec('e2e/file.open-url.spec.ts', DESKTOP, [
    'FR-FIL-006: ?src= fetches a .flux and opens it in the editor under the file’s name',
    'FR-FIL-006: a .flux pasted on the home page opens',
  ]);
  return saved === true ? urls : urls === true ? saved : `${saved}; ${urls}`;
});
leg('an edit killed 5 s before the crash is recovered, with the details-dialog metadata (file.crash-recovery)', () =>
  titledSpec('e2e/file.crash-recovery.spec.ts', DESKTOP, [
    'FR-FIL-007: a tab closed after an edit leaves the work, and the next start offers it, recovers it with its title, and keeps it as unsaved',
    'FR-FIL-007: Discard forgets the work for good, and Not now keeps it for the next start',
  ]),
);
leg('autosave journals within its budget and keeps the last 20 versions', () => {
  const kept = titled([['M10.18', 'FR-FIL-007: after 25 writes exactly the newest 20 versions remain', STUDIO]]);
  const budget = titledSpec('e2e/file.autosave-status.spec.ts', DESKTOP, [
    'FR-FIL-007: an edit is written within the autosave budget and the status line says the changes are kept',
  ]);
  return kept === true ? budget : budget === true ? kept : `${kept}; ${budget}`;
});
leg('recent files and the local library list documents with thumbnails (file.library)', () =>
  titledSpec('e2e/file.library.spec.ts', DESKTOP, ['FR-FIL-008: a saved file is listed on the home page with its preview, and opens from the list']),
);

// ── size and fidelity (NFR-SIZE-003, FR-FIL-001) ────────────────────────────────────────────────────
leg(`a 20-screen document stays within DOC20_FLUX_BYTES (${t('DOC20_FLUX_BYTES')}) and DOC20_FLUX_HTML_BYTES (${t('DOC20_FLUX_HTML_BYTES')})`, () => {
  const doc = json('fixtures/docs/doc20.flux.json');
  const screens = Object.values(doc?.records ?? {}).filter((r) => r.type === 'screen').length;
  if (screens < 20) return `fixtures/docs/doc20.flux.json has ${screens} screens (< 20)`;
  return titled([
    ['M10.20', 'NFR-SIZE-003: the 20-screen document in .flux is within DOC20_FLUX_BYTES', FORMAT],
    ['M10.20', 'NFR-SIZE-003: the 20-screen document in .flux.html is within DOC20_FLUX_HTML_BYTES', FORMAT],
  ]);
});
leg('the studio and the .flux.html from file:// draw the same screens within 0.1 % (file.fidelity)', () =>
  titledSpec('e2e/file.fidelity.spec.ts', DESKTOP, ['FR-FIL-001: every screen of the 20-screen document is within 0.1 percent of the studio render']),
);

// ── coverage, docs, changesets ──────────────────────────────────────────────────────────────────────
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
leg('packages/format coverage at or above COVERAGE_PURE_LINES/BRANCHES', () =>
  coverageLeg('packages/format', { lines: t('COVERAGE_PURE_LINES'), branches: t('COVERAGE_PURE_BRANCHES') }),
);
leg('docs: the "Saving & opening" guide and the format specification', () => {
  if (!exists(GUIDE)) return `missing ${GUIDE}`;
  if (!exists('specs/format/flux-1.0.md')) return 'missing specs/format/flux-1.0.md';
  return readmeGaps(readText(GUIDE), ['.flux', 'autosave', 'recover', 'offline', 'open']);
});
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M10\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M10 commits yet';
});

// ── the tree, CI and the review ──────────────────────────────────────────────────────
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
leg('CI green on ubuntu, windows and macos, visual job included, at or after the M10 final review range', () => {
  if (!exists('.harness/reviews/milestone-M10-final.json')) return 'no M10 final review yet: its range end is what the evidence must cover';
  const unit = namedCases('tests/harness/ci-evidence.test.mjs', ['evidence without a green visual job fails']);
  return unit === true ? ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M10'])) : unit;
});
leg('every M10 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M10'), 'M10', loadMilestoneReviews('M10')));
leg('final milestone review covers M10', () => {
  const rev = json('.harness/reviews/milestone-M10-final.json');
  return rev ? checkFinalReview(rev, 'M10') : 'missing .harness/reviews/milestone-M10-final.json';
});
leg(
  'roadmap advanced past M10',
  () =>
    !['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10'].includes(currentMilestone()) || `roadmap Current milestone is ${currentMilestone()}`,
);

await runLegs('m10');
