#!/usr/bin/env node
// Completion gate for M11 — Player v1 & MVP release, the R1 exit (docs/milestones/M11.md). Written first and red (M11.1). Legs are behavioural:
// each runs the real spec, test, gate or build. The e2e legs name the spec files and require them to pass on their projects; the rows that
// write a spec add its titles here (a plan-time title that no test carries hid gaps in M10, so none is guessed). M11 started while M10's rows
// M10.27, M10.45 and M10.57 wait for the human (docs/backlog/current.md), so this gate does not wait for M10 to close.
import { existsSync, readFileSync } from 'node:fs';
import { createE2e, DESKTOP, MOBILE, PERF } from './editor-gate.mjs';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import {
  backlogTextFor,
  changesetsCoverRange,
  checkBacklogDone,
  checkFinalReview,
  loadMilestoneReviews,
  titled,
  verifyLeg,
  vitestTitles,
} from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);
const DEMO = 'examples/r1-mvp-deck.flux.html';

/** Every title in `ids` (the exact titles the backlog rows quote, not a bare requirement id that older tests already carry) names at least one executed, passing Vitest test in `project`. */
function byId(ids, paths, project = 'node') {
  const verdicts = vitestTitles(ids, paths, { project });
  const bad = verdicts.map((v, i) => (v === true ? null : `${ids[i]}: ${v}`)).filter(Boolean);
  return bad.length === 0 || bad.join('; ');
}

const { e2e } = createE2e({
  desktop: {
    projects: DESKTOP,
    specs: [
      'e2e/player.letterbox.spec.ts',
      'e2e/player.keyboard-nav.spec.ts',
      'e2e/player.no-mutation-fuzz.spec.ts',
      'e2e/player.deep-link.spec.ts',
      'e2e/player.chrome.spec.ts',
      'e2e/player.embed.spec.ts',
      'e2e/player.keyboard-only.spec.ts',
      'e2e/a11y.player.spec.ts',
      'e2e/privacy.no-telemetry.spec.ts',
      'e2e/mvp.create-save-reopen-present.spec.ts',
      'e2e/examples.r1-offline.spec.ts',
    ],
  },
  mobile: { projects: MOBILE, specs: ['e2e/player.touch.spec.ts', 'e2e/player.orientation.spec.ts'] },
  perf: { projects: PERF, specs: ['e2e/perf.open-50.spec.ts'], workers: 1 },
});

leg('check-trace --milestone M11 and --increment R1 green', () => {
  const m = ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M11']));
  return m === true ? ok(node('scripts/gates/check-trace.mjs', ['--increment', 'R1'])) : m;
});

// ── decisions ────────────────────────────────────────────────────────────
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
leg('ADR-0026 player packaging is accepted', adrLeg('0026', ['fluxion-player', 'shadow', 'React', 'Zod', 'lazy']));
leg('ADR-0027 observability and privacy is accepted', adrLeg('0027', ['Logger', 'overlay', 'diagnostic', 'telemetry']));

// ── the player (FR-PRS-001..006, FR-PRS-009, FR-RSP-001, FR-RSP-007) ───────────────────────────────
leg('the navigator order, the controller, hidden screens and build reduction are each tested and pass (T0)', () =>
  byId(
    [
      "FR-SCR-004: with sections, first and next visit the screens in the navigator's order",
      'FR-SCR-002: a hidden screen is never visited by next',
      'FR-PRS-002: goTo and the history return to earlier positions',
      'FR-PRS-003: seeking group k equals stepping k times from 0',
    ],
    ['packages/player', 'packages/anim', 'packages/core', 'packages/editor'],
  ),
);
leg('full-screen letterboxing on three engines (player.letterbox)', () => e2e(['e2e/player.letterbox.spec.ts'], DESKTOP));
leg('navigation by every key, the overview grid and present in place (player.keyboard-nav)', () => e2e(['e2e/player.keyboard-nav.spec.ts'], DESKTOP));
leg('present mode cannot edit: 500 random events leave the document unchanged (player.no-mutation-fuzz)', () =>
  e2e(['e2e/player.no-mutation-fuzz.spec.ts'], DESKTOP),
);
leg('a deep link restores the position and the browser back button works (player.deep-link)', () => e2e(['e2e/player.deep-link.spec.ts'], DESKTOP));
leg('the chrome shows progress and hides after idle (player.chrome)', () => e2e(['e2e/player.chrome.spec.ts'], DESKTOP));
leg('the <fluxion-player> element and the React wrapper embed in a plain page (player.embed)', () => e2e(['e2e/player.embed.spec.ts'], DESKTOP));
leg('swipe, tap, pinch and rotation on the phone projects (player.touch, player.orientation)', () =>
  e2e(['e2e/player.touch.spec.ts', 'e2e/player.orientation.spec.ts'], MOBILE),
);
leg('the whole deck can be presented from the keyboard alone (player.keyboard-only)', () => e2e(['e2e/player.keyboard-only.spec.ts'], DESKTOP));

// ── accessibility, privacy, observability ───────────────────────────────────────────────────────────
leg('axe finds no serious or critical issue in the player and the editor (a11y.player)', () => e2e(['e2e/a11y.player.spec.ts'], DESKTOP));
leg('a session of edit, save and present makes no request to a non-local host (privacy.no-telemetry)', () =>
  e2e(['e2e/privacy.no-telemetry.spec.ts'], DESKTOP),
);
leg('the Logger and the diagnostic report are tested (T0), the overlay toggle (T1), and the privacy page exists', () => {
  const node0 = byId(['NFR-OBS-001: the logger honours its level and namespaces', 'NFR-OBS-002: the report holds no document text'], ['packages', 'apps']);
  const dom = byId(['NFR-OBS-001: the overlay toggles from its shortcut'], ['packages', 'apps'], 'browser');
  const page = exists('docs/privacy.md') || 'missing docs/privacy.md';
  return [node0, dom, page].every((r) => r === true) || [node0, dom, page].filter((r) => r !== true).join('; ');
});

// ── size and performance (NFR-SIZE-001, NFR-SIZE-002, NFR-PERF-003) ─────────────────────────────────
leg(`the one-file player is within PLAYER_CORE_GZIP (${t('PLAYER_CORE_GZIP')}) and the editor within EDITOR_INITIAL_GZIP (${t('EDITOR_INITIAL_GZIP')})`, () => {
  const cfg = readText('.size-limit.js');
  if (!/name: 'player-inline'[^}]*PLAYER_CORE_GZIP/.test(cfg)) return ".size-limit.js: the player-inline entry is not held to t('PLAYER_CORE_GZIP')";
  return ok(run('pnpm', ['exec', 'size-limit']));
});
leg(
  `opening 50 screens shows the first within OPEN_50_SCREENS_MS_DESKTOP (${t('OPEN_50_SCREENS_MS_DESKTOP')}) and _MOBILE (${t('OPEN_50_SCREENS_MS_MOBILE')}) (perf.open-50)`,
  () => {
    if (!exists('fixtures/docs/doc50.flux.json')) return 'missing fixtures/docs/doc50.flux.json';
    return e2e(['e2e/perf.open-50.spec.ts'], PERF);
  },
);
leg(`the editor is interactive within EDITOR_TTI_MS (${t('EDITOR_TTI_MS')}) on the Lighthouse job, whose result is CI evidence`, () => {
  if (!exists('lighthouserc.mjs')) return 'missing lighthouserc.mjs';
  if (!/EDITOR_TTI_MS/.test(readText('lighthouserc.mjs'))) return "lighthouserc.mjs does not read t('EDITOR_TTI_MS')";
  const wf = exists('.github/workflows/ci.yml') ? readText('.github/workflows/ci.yml') : '';
  if (!/lhci|lighthouse/i.test(wf)) return 'ci.yml has no Lighthouse job';
  // the CI evidence gate must demand that job's pass (M11.19 adds it to REQUIRED), so a green milestone cannot sit on a red or absent Lighthouse run
  return /\['lighthouse'\]/.test(readText('scripts/gates/check-ci-evidence.mjs')) || "check-ci-evidence.mjs does not require the 'lighthouse' job";
});

leg('the browser matrix: all five projects in CI and a nightly run on the previous major (NFR-PORT-001)', () => {
  const ci = exists('.github/workflows/ci.yml') ? readText('.github/workflows/ci.yml') : '';
  const missing = ['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari'].filter(
    (p) => !new RegExp(`\\b${p}\\b`).test(ci + readText('playwright.config.ts')),
  );
  if (missing.length) return `no CI project for ${missing.join(', ')}`;
  if (!exists('.github/workflows/nightly.yml')) return 'missing .github/workflows/nightly.yml (the previous-major run)';
  return /previous/i.test(readText('.github/workflows/nightly.yml')) || 'nightly.yml does not run a previous major';
});
leg('NFR-SIZE-003: the 20-screen .flux.html size is decided (M10.45, ADR-0157: gzip) and its test passes', () => e2e(['e2e/file.size.spec.ts'], DESKTOP));

// ── the demo, the exit, the docs ────────────────────────────────────────────────────────────────────
// the five screens are asserted by the journey spec, which builds the deck by hand; the offline spec opens the committed file
leg('the R1 demo has five screens and presents offline from file:// on three engines (mvp.create-save-reopen-present, examples.r1-offline)', () => {
  if (!exists(DEMO)) return `missing ${DEMO}`;
  const made = e2e(['e2e/mvp.create-save-reopen-present.spec.ts'], DESKTOP);
  return made === true ? e2e(['e2e/examples.r1-offline.spec.ts'], DESKTOP) : made;
});
leg('docs/milestones/R1-exit.md is complete: every checklist box ticked', () => {
  if (!exists('docs/milestones/R1-exit.md')) return 'missing docs/milestones/R1-exit.md';
  const open = (readText('docs/milestones/R1-exit.md').match(/^- \[ \]/gm) ?? []).length;
  return open === 0 || `${open} unticked boxes in R1-exit.md`;
});
leg('the docs site builds and has a Presenting page', () => {
  if (!exists('apps/docs/src/content/docs/guides/presenting.md')) return 'missing apps/docs/src/content/docs/guides/presenting.md';
  return ok(run('pnpm', ['--filter', '@fluxion/docs', 'run', 'build']));
});
leg('changesets cover every package the milestone range changed', () => {
  const first = run('git', ['rev-list', '--reverse', '--grep=^M11\\.', 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  return first ? changesetsCoverRange(`${first}~1`) : 'no M11 commits yet';
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
leg('CI green on ubuntu, windows and macos, visual job included, at or after the M11 final review range', () => {
  if (!exists('.harness/reviews/milestone-M11-final.json')) return 'no M11 final review yet: its range end is what the evidence must cover';
  return ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M11']));
});
leg('every M11 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M11'), 'M11', loadMilestoneReviews('M11')));
leg('final milestone review covers M11', () => {
  const rev = json('.harness/reviews/milestone-M11-final.json');
  return rev ? checkFinalReview(rev, 'M11') : 'missing .harness/reviews/milestone-M11-final.json';
});
leg('roadmap advanced past M11', () => !/^M(\d|1[01])$/.test(currentMilestone() ?? '') || `roadmap Current milestone is ${currentMilestone()}`);

await runLegs('m11');
