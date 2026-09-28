#!/usr/bin/env node
// Completion gate for M4 — Static renderer & CLI v0, R0 exit (docs/milestones/M4.md).
// Written first and red (M4.1). Legs are behavioural: each runs the real tool, test or gate.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import * as checks from './milestone-checks.mjs';
import { backlogTextFor, checkBacklogDone, checkFinalReview, loadMilestoneReviews, namedCases, titled, verifyLeg } from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const pnpm = (...a) => run('pnpm', a);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);
const CLI_BIN = 'packages/cli/dist/bin.js';
const DEMO = 'examples/r0-static.flux.json';

/** Source text without comments, so a commented-out call or step never satisfies a leg (M4.1 review F5). */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const yamlCode = (text) => text.replace(/(^|\s)#.*$/gm, '$1');

// the CLI legs run the current sources, never a stale dist: build once, first (M4.1 review F4)
let buildResult;
const built = () => {
  buildResult ??= ok(pnpm('run', 'build'));
  return buildResult;
};

/** Run the freshly built CLI; a failed build or a missing bin is a red leg, not a crash. */
function cli(args) {
  const b = built();
  if (b !== true) return { status: 1, stdout: '', stderr: `build failed: ${b}` };
  if (!exists(CLI_BIN)) return { status: 1, stdout: '', stderr: `missing ${CLI_BIN} after the build` };
  return run(process.execPath, [repoPath(CLI_BIN), ...args]);
}

/** Every tzap/Stryker disable comment in `dir` is a `next-line` comment naming its reason (no `all`, no `line`). */
function disablesWithoutReason(dir) {
  const r = run('git', ['grep', '-n', '-I', '-E', '(tzap|Stryker) disable', '--', dir]);
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !/disable next-line [A-Za-z,]+: \S.{8,}/.test(l));
}

leg('check-trace --milestone M4 green', () => ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M4'])));
leg('check-trace --increment R0 green (R0 exit)', () => ok(node('scripts/gates/check-trace.mjs', ['--increment', 'R0'])));

// ── M3 final-review hand-offs (M4.md "Handed off from M3") ──────────────────────────────────────
leg('commands refuse history origins and name argument errors COMMAND_ARGS (M3 final F2, F5)', () =>
  titled([
    ['M4.4', 'NFR-MNT-006: a command cannot run with an undo or redo origin', 'core'],
    ['M4.4', 'FR-EXT-001: an unknown id argument returns COMMAND_ARGS', 'core'],
    ['M4.4', 'NFR-MNT-006: applying a store that is not a fork carries a diagnostic', 'core'],
  ]),
);
leg('one wired core bootstrap and core determinism (M3 final F3, F4)', () =>
  titled([
    ['M4.5', 'FR-EXT-001: the core bootstrap cascades a bound shape delete', 'core'],
    ['M4.5', 'NFR-REL-005: the same command sequence twice gives equal diffs, history and document', 'core'],
  ]),
);
leg('write-path test catches transact through call, apply and bind (M3 final F6)', () =>
  namedCases('tests/harness/architecture.test.mjs', ['transact through call, apply or bind fails', 'a ctx-named helper outside a command fails']),
);
// the undo budget keeps being measured: one shared bench leg, used here (M3 final F1)
leg('undo/redo/transact benches within UNDO_MAX_MS through the shared bench leg (M3 final F1)', () => {
  if (typeof checks.benchLeg !== 'function') return 'milestone-checks.mjs exports no benchLeg (M4.7)';
  const shared = namedCases('tests/harness/bench-leg.test.mjs', ['a bench over UNDO_MAX_MS fails the shared leg']);
  return shared === true ? checks.benchLeg(t('UNDO_MAX_MS')) : shared;
});
/** `pnpm mutate` runs tzap, directly or through a wrapper script that calls it; the leg's run proves it. */
function mutateScriptProblem() {
  const pkg = json('package.json');
  const script = pkg?.scripts?.mutate ?? '';
  const wrapper = /node\s+(\S+\.mjs)/.exec(script)?.[1];
  const runsTzap = script.includes('tzap') || (wrapper !== undefined && exists(wrapper) && /\btzap\b/.test(code(readText(wrapper))));
  if (!runsTzap) return 'package.json `mutate` does not run tzap (M4.3)';
  return pkg.devDependencies?.['@huyz0/tzap'] ? null : '@huyz0/tzap is not a root devDependency (M4.3)';
}

/**
 * The nightly mutation job runs tzap in a step, not merely stops printing SKIP (M4.1 review F1): a
 * command line of a run step (inline or in a `run: |` block) starts with the call; an echo is not a run.
 */
function nightlyMutationProblem() {
  const nightly = yamlCode(readText('.github/workflows/nightly.yml'));
  const job = /\n {2}mutation:\n([\s\S]*?)(?=\n {2}\w[\w-]*:\n|$)/.exec(nightly)?.[1] ?? '';
  const commands = [...job.matchAll(/run:\s*(\|[^\n]*\n((?:\s{10,}[^\n]*\n?)*)|[^\n]*)/g)].flatMap((m) => (m[2] ?? m[1]).split('\n').map((l) => l.trim()));
  const runs = commands.some((c) => /^(pnpm (run )?mutate|pnpm exec tzap run|npx tzap run)\b/.test(c));
  return runs ? null : 'the nightly mutation job does not run pnpm mutate (M4.3)';
}

leg('mutation testing with tzap: pnpm mutate, nightly job, core floor (user decision, ADR)', () => {
  const setup = mutateScriptProblem() ?? nightlyMutationProblem();
  if (setup) return setup;
  const floors = json('.harness/baselines/mutation.json');
  const floor = floors?.packages?.['packages/core']?.score;
  // M4.8 triages the M3 survivors: the floor is the triaged score, at or above MUTATION_CORE_TARGET
  // (thresholds.mjs, check-drift guards it), well above the untriaged 84 % of the M3 trial
  if (!(floor >= t('MUTATION_CORE_TARGET')))
    return `core mutation floor ${floor ?? 'missing'} is below MUTATION_CORE_TARGET ${t('MUTATION_CORE_TARGET')} % (M4.8)`;
  // a survivor is killed by a test, or disabled with its reason on its own line: never silenced in bulk
  const bare = disablesWithoutReason('packages/core/src');
  if (bare.length) return `disable comments without a reason or in bulk: ${bare.slice(0, 3).join(' | ')}`;
  const dir = mkdtempSync(join(tmpdir(), 'm4-mutate-'));
  try {
    const r = pnpm('run', 'mutate', '--package', 'packages/core', '--out-dir', dir);
    const report = join(dir, 'tzap.json');
    if (!existsSync(report)) return `no tzap report: ${ok(r)}`;
    const { mutationScore, noCoverage } = JSON.parse(readFileSync(report, 'utf8')).score;
    if (noCoverage > 0) return `${noCoverage} core mutant(s) no test reaches`;
    return mutationScore >= floor || `core mutation score ${mutationScore.toFixed(1)} % is below its floor ${floor} %`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── theme and resolved styles (plan rows 2-3) ───────────────────────────────────────────────────
leg('theme: tokens resolve against the light theme and emit CSS variables', () =>
  titled([
    ['M4.9', 'FR-THM-001: {color.primary} resolves to the light theme value', 'theme'],
    ['M4.9', 'FR-THM-001: toCssVars emits --fx-color-primary', 'theme'],
  ]),
);
leg('resolved style: a literal beats a token; an unknown token falls back with FLX_TOKEN_UNKNOWN', () =>
  titled([
    ['M4.10', 'FR-THM-001: a literal always beats a token', 'theme'],
    ['M4.10', 'FR-THM-001: an unknown token falls back with FLX_TOKEN_UNKNOWN', 'theme'],
  ]),
);

// ── render (plan rows 4-9), T1 in Chromium ─────────────────────────────────────────────────────
const browser = (row, title) => [row, title, 'render', {}, 'browser'];
leg('render: ScreenView fit, backgrounds, order, registry placeholder, rect, connector (T1)', () =>
  titled([
    browser('M4.11', 'FR-SCR-001: a 1920x1080 screen fits a 960x540 box at scale 0.5'),
    browser('M4.12', 'FR-SCR-001: renders each background kind'),
    browser('M4.12', 'FR-SCR-001: screens render in fractional-index order'),
    browser('M4.13', 'FR-DOC-005: an unregistered kind renders a labelled placeholder and keeps the record'),
    browser('M4.14', 'FR-SHP-001: rendered bounds equal the transform'),
    browser('M4.14', 'FR-SHP-001: rotation is about the center'),
    browser('M4.15', 'FR-CON-001: renders straight line between bound shapes'),
  ]),
);
leg('mode is read only in render/src/mode-policy.ts (gate + negative case)', () => {
  if (!exists('scripts/gates/check-mode-policy.mjs')) return 'missing scripts/gates/check-mode-policy.mjs (M4.11)';
  const r = node('scripts/gates/check-mode-policy.mjs');
  if (r.status !== 0) return ok(r);
  return namedCases('tests/harness/mode-policy.test.mjs', ['a mode read outside mode-policy fails']);
});
// the SSR HTML is styled (inlined content CSS, every --fx var it uses defined) and equals the browser
// render per fixture (plan risks 1-2; M4 cp1 F1)
leg('ssr: static HTML with no scripts, styled, and equal to the browser render', () =>
  titled([
    ['M4.16', 'FR-CLI-001: static HTML has no script and one .fx-screen per visible screen', 'render'],
    ['M4.16', 'FR-THM-001: the static HTML inlines the content CSS and defines every --fx variable it uses', 'render'],
    browser('M4.16', 'FR-SCR-001: SSR markup equals the browser render for each fixture'),
  ]),
);
leg('SVG goldens match and a second render is byte-identical', () =>
  titled([['M4.19', 'NFR-REL-005: SVG goldens match and a second render is byte-identical', 'render']]),
);

// ── CLI (plan rows 10-13): e2e tests spawn the built bin; CI runs them on three OSes ───────────
const CLI_E2E = ['packages/cli/src/e2e/cli.validate.test.ts', 'packages/cli/src/e2e/cli.render.test.ts'];
leg('CLI e2e suites spawn the built bin and pass', () => {
  const missing = CLI_E2E.filter((f) => !exists(f));
  if (missing.length) return `missing ${missing.join(', ')}`;
  // the suites spawn the built bin: a spawn call and the dist path in code, not in a comment (M4.1
  // review F5), in the suite itself or in a helper module it imports from its own folder (M4.33)
  const withHelpers = (f) => {
    const src = code(readText(f));
    const helpers = [...src.matchAll(/from\s+['"]\.\/([\w-]+)\.js['"]/g)].map((m) => join(dirname(f), `${m[1]}.ts`)).filter((p) => exists(p));
    return [src, ...helpers.map((p) => code(readText(p)))].join('\n');
  };
  const spawnsBin = CLI_E2E.filter((f) => {
    const src = withHelpers(f);
    return !/\b(spawnSync|spawn|execFileSync|execFile)\(/.test(src) || !/dist['"`/\\,\s]+bin\.js/.test(src);
  });
  if (spawnsBin.length) return `${spawnsBin.join(', ')} do not spawn the built bin`;
  const b = built();
  if (b !== true) return `build failed: ${b}`;
  return titled([
    ['M4.17', 'FR-CLI-001: --help lists validate and render', 'cli'],
    ['M4.17', 'FR-CLI-001: an unknown flag exits 2', 'cli'],
    ['M4.18', 'FR-CLI-001: validate reports JSON-pointer diagnostics and exits 1', 'cli'],
    ['M4.20', 'FR-CLI-001: render writes the two-rects-line HTML matching the golden', 'cli'],
  ]);
});
// the reply schemas are generated snapshots where contracts.md §1 puts them (ADR-0147, M4.17 review F1)
leg('the CLI --json replies have generated schemas in packages/cli/schemas/', () => {
  const dir = repoPath('packages/cli/schemas');
  const schemas = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.output.json')) : [];
  const missing = ['validate', 'render'].filter((c) => !schemas.includes(`${c}.output.json`));
  return missing.length === 0 || `no packages/cli/schemas/${missing.join(', ')}.output.json (M4.17)`;
});

// ── visual baseline and the R0 demo (plan rows 15-16) ──────────────────────────────────────────
leg('visual spec render.static-html.spec.ts is @visual with baselines for the three desktop engines', () => {
  const spec = 'e2e/render.static-html.spec.ts';
  if (!exists(spec)) return `missing ${spec}`;
  // a test titled @visual that calls toHaveScreenshot, in code: CI selects visual tests by title (M4.1 review F5)
  const src = code(readText(spec));
  if (!/test\(\s*['"`][^'"`]*@visual/.test(src) || !/toHaveScreenshot\(/.test(src)) return `${spec} has no @visual test calling toHaveScreenshot`;
  const snaps = repoPath(`${spec}-snapshots`);
  const pngs = existsSync(snaps) ? readdirSync(snaps).filter((f) => f.endsWith('.png')) : [];
  const engines = ['chromium', 'firefox', 'webkit'].filter((e) => !pngs.some((p) => p.includes(`-${e}-`)));
  // the pixels are judged in the pinned image by CI's visual job, which the CI-evidence leg requires
  return engines.length === 0 || `no baseline for ${engines.join(', ')} in ${spec}-snapshots`;
});
leg(`${DEMO} validates and renders to HTML with no scripts; CI renders it and uploads the artifact`, () => {
  if (!exists(DEMO)) return `missing ${DEMO}`;
  const v = cli(['validate', DEMO]);
  if (v.status !== 0) return `validate: ${ok(v)}`;
  const dir = mkdtempSync(join(tmpdir(), 'm4-demo-'));
  try {
    const out = join(dir, 'r0.html');
    const r = cli(['render', DEMO, '-o', out]);
    if (r.status !== 0 || !existsSync(out)) return `render: ${ok(r)}`;
    const html = readFileSync(out, 'utf8');
    if (/<script\b/i.test(html)) return 'the demo HTML has a <script>';
    // two screens, each with a shape, a connector path and a token style (M4 cp1 F8)
    const content = checks.checkDemoHtml(html, 2);
    if (content !== true) return `the demo HTML: ${content}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // a run step renders the demo to a file and an upload-artifact step uploads that file (not a comment)
  const ci = yamlCode(readText('.github/workflows/ci.yml'));
  const renders = /run:[^\n]*(fluxion|dist\/bin\.js)[^\n]*\brender\s+examples\/r0-static\.flux\.json\s+-o\s+(\S+)/.exec(ci);
  if (!renders) return 'ci.yml has no run step rendering the demo with -o <file>';
  const steps = ci.split(/\n\s+- /);
  const uploads = steps.some((step) => /uses: actions\/upload-artifact@/.test(step) && /\n\s+path:[^\n]*/.test(step) && step.includes(renders[2]));
  return uploads || `no upload-artifact step uploads ${renders[2]}`;
});

// ── coverage floors (plan legs) ────────────────────────────────────────────────────────────────
function coverage(pkg, lines, branches, min) {
  const dir = mkdtempSync(join(tmpdir(), 'm4-cov-'));
  try {
    const r = pnpm(
      'exec',
      'vitest',
      'run',
      '--coverage',
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory=${dir}`,
      '--reporter=json',
      `--outputFile=${join(dir, 'report.json')}`,
      `packages/${pkg}`,
    );
    const report = join(dir, 'report.json');
    if (!existsSync(report)) return `vitest wrote no report: ${ok(r)}`;
    const { numFailedTests, numPassedTests } = JSON.parse(readFileSync(report, 'utf8'));
    if (numFailedTests > 0 || numPassedTests === 0) return `${pkg}: ${numFailedTests} failed, ${numPassedTests} passed`;
    const summary = join(dir, 'coverage-summary.json');
    if (!existsSync(summary)) return `no coverage summary: ${ok(r)}`;
    const files = Object.entries(JSON.parse(readFileSync(summary, 'utf8'))).filter(([f]) => f.replace(/\\/g, '/').includes(`/packages/${pkg}/src/`));
    const sum = (k, f) => files.reduce((a, [, v]) => a + v[k][f], 0);
    const pct = (k) => (sum(k, 'total') === 0 ? 0 : (100 * sum(k, 'covered')) / sum(k, 'total'));
    const bad = [];
    // a stub package cannot pass: it must have real code to cover
    if (sum('statements', 'total') < min) bad.push(`${sum('statements', 'total')} statements (< ${min})`);
    if (pct('lines') < lines) bad.push(`lines ${pct('lines').toFixed(1)}%`);
    if (pct('branches') < branches) bad.push(`branches ${pct('branches').toFixed(1)}%`);
    return bad.length === 0 || `${pkg}: ${bad.join('; ')}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
leg('theme coverage at or above the pure-package floors', () => coverage('theme', t('COVERAGE_PURE_LINES'), t('COVERAGE_PURE_BRANCHES'), 80));
leg('render coverage at or above the render floors', () => coverage('render', t('COVERAGE_RENDER_LINES'), t('COVERAGE_RENDER_BRANCHES'), 150));

// ── R0 exit (plan row 17) ──────────────────────────────────────────────────────────────────────
leg('R0-exit.md checklist complete (every item checked, each with evidence)', () => {
  const f = 'docs/milestones/R0-exit.md';
  if (!exists(f)) return `missing ${f}`;
  const items = readText(f)
    .split(/\r?\n/)
    .filter((l) => /^\s*- \[[ x]\]/.test(l));
  if (items.length < 5) return `${f} lists ${items.length} checklist items (the five common exit criteria at least)`;
  const open = items.filter((l) => /^\s*- \[ \]/.test(l) || !/—\s*\S/.test(l));
  return open.length === 0 || `unchecked or without evidence: ${open.map((l) => l.trim().slice(0, 50)).join(' | ')}`;
});
leg('changesets name every package M4 changed (theme, render, cli, core)', () => {
  const dir = repoPath('.changeset');
  const text = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
  const missing = ['@fluxion/theme', '@fluxion/render', '@fluxion/cli', '@fluxion/core'].filter((p) => !text.includes(`'${p}'`) && !text.includes(`"${p}"`));
  return missing.length === 0 || `no changeset for ${missing.join(', ')}`;
});

// every planned verify step must PASS, through the shared leg (CI unset)
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

leg('CI green on ubuntu, windows and macos at or after the M4 final review range', () =>
  ok(node('scripts/gates/check-ci-evidence.mjs', ['--milestone', 'M4'])),
);
leg('every M4 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M4'), 'M4', loadMilestoneReviews('M4')));
leg('final milestone review covers M4', () => {
  const rev = json('.harness/reviews/milestone-M4-final.json');
  return rev ? checkFinalReview(rev, 'M4') : 'missing .harness/reviews/milestone-M4-final.json';
});
leg('roadmap advanced past M4', () => !['M0', 'M1', 'M2', 'M3', 'M4'].includes(currentMilestone()) || `roadmap Current milestone is ${currentMilestone()}`);

await runLegs('m4');
