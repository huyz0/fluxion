#!/usr/bin/env node
// Completion gate for M1 — Monorepo & toolchain skeleton (docs/milestones/M1.md).
// Written first and red (M1.1). Legs are behavioural: each runs the real tool or gate.
import { existsSync, readFileSync } from 'node:fs';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import { backlogTextFor, checkBacklogDone, checkFinalReview, loadMilestoneReviews } from './milestone-checks.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const pnpm = (...a) => run('pnpm', a);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);

const PACKAGES = ['schema', 'geometry', 'core', 'theme', 'layout', 'routing', 'anim', 'format', 'dsl', 'render', 'player', 'editor', 'sdk', 'cli', 'mcp', 'exporters'];
const WORKSPACES = [...PACKAGES.map((p) => `packages/${p}`), 'apps/studio', 'apps/docs', 'packs/basic'];

leg('pnpm workspace installs from the frozen lockfile', () => {
  if (!exists('package.json') || !exists('pnpm-lock.yaml') || !exists('pnpm-workspace.yaml')) return 'missing package.json, pnpm-lock.yaml or pnpm-workspace.yaml';
  return ok(pnpm('install', '--frozen-lockfile', '--prefer-offline'));
});
leg('all 16 packages, 2 apps and packs/basic have src/index.ts, README.md, AGENTS.md, LICENSE', () => {
  const missing = WORKSPACES.flatMap((w) => ['src/index.ts', 'README.md', 'AGENTS.md', 'LICENSE'].filter((f) => !exists(`${w}/${f}`)).map((f) => `${w}/${f}`));
  return missing.length === 0 || `missing ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (+${missing.length - 5})` : ''}`;
});
leg('turbo build reruns as a full cache hit', () => {
  if (!exists('turbo.json')) return 'missing turbo.json';
  const first = pnpm('turbo', 'run', 'build');
  if (first.status !== 0) return ok(first);
  const second = pnpm('turbo', 'run', 'build');
  return /FULL TURBO/.test(second.stdout) || 'second build was not a full cache hit';
});
leg('pnpm verify exits 0 with no SKIP lines (every gate exists and ran)', () => {
  if (!exists('package.json')) return 'no package.json';
  const r = pnpm('verify');
  if (r.status !== 0) return ok(r);
  const skips = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('SKIP'));
  return skips.length === 0 || `skipped: ${skips.map((l) => l.split(' ')[1]).join(', ')}`;
});

// Each M1 gate: the script runs green on the repo, and its negative test exists and contains at
// least one case that expects failure (a non-zero status) — an empty test file cannot pass this.
const EXPECTS_FAILURE = /status,\s*[123]\b|notEqual\([^)]*status|status\s*!==\s*0|\.rejects\(|assert\.throws\(/;
const GATES = [
  // the descoping loophole has its own behavioural leg below (probeDescoping)
  ['workflows (actionlint/zizmor)', ['scripts/gates/check-workflows.mjs', ['--require-docker']], 'tests/harness/workflows.test.mjs'],
  ['tsconfig strictness', null, 'tests/harness/tsconfig-strict.test.mjs'],
  ['workspace shape', null, 'tests/harness/workspace-shape.test.mjs'],
  ['biome rules', null, 'tests/harness/biome.test.mjs'],
  ['size (filename denylist)', ['scripts/gates/check-size.mjs', ['--all']], 'tests/harness/size.test.mjs', /utils/],
  ['layering', ['scripts/gates/check-layering.mjs', []], 'tests/harness/layering.test.mjs'],
  ['trace', ['scripts/gates/check-trace.mjs', ['--milestone', 'M1']], 'tests/harness/trace.test.mjs'],
  ['api reports', ['scripts/gates/check-api.mjs', []], 'tests/harness/api.test.mjs'],
  ['licenses', ['scripts/gates/check-licenses.mjs', []], 'tests/harness/licenses.test.mjs'],
  ['budget', ['scripts/gates/check-budget.mjs', []], 'tests/harness/budget.test.mjs'],
];
for (const [name, gate, test, mustMention] of GATES) {
  leg(`gate ${name}: runs green and has a failing-case negative test`, () => {
    if (gate) {
      if (!exists(gate[0])) return `missing ${gate[0]}`;
      const r = node(gate[0], gate[1]);
      if (r.status !== 0) return ok(r);
    }
    if (!exists(test)) return `missing ${test}`;
    const src = readText(test);
    if (!EXPECTS_FAILURE.test(src)) return `${test} has no case expecting a non-zero exit`;
    return !mustMention || mustMention.test(src) || `${test} does not cover ${mustMention}`;
  });
}
// M1.2 (M0 final F1), exercised directly: a descoped reason without an ADR or Deferred citation
// must not close a row, and a State-only change to `descoped` must not be review-exempt.
leg('descoping loophole closed (behavioural probe)', () => {
  const row = (state) => `| M9.1 | t | NFR-DX-003 | x | - | ${state} | |`;
  if (checkBacklogDone(row('descoped (not feasible)'), 'M9') === true) return 'descoped without ADR/Deferred citation still closes a row';
  if (checkBacklogDone(row('descoped (user decision; ADR-0137)'), 'M9') !== true) return 'descoped citing an ADR does not close a row';
  // run the check-reviewed case that stages a State change to descoped in a temp repo; it must
  // exist, run and pass (a grep for the word could be satisfied by a comment)
  const r = run(process.execPath, ['--test', '--test-reporter=spec', '--test-name-pattern=State cell changes to descoped', 'tests/harness/review.test.mjs']);
  const passed = Number(/^ℹ pass (\d+)/m.exec(r.stdout)?.[1] ?? 0);
  if (r.status !== 0 || passed < 1) return `check-reviewed descoped case did not run/pass (pass=${passed})`;
  return true;
});
leg('harness test suite passes', () => ok(run(process.execPath, ['--test', 'tests/harness/*.test.mjs'])));
leg('no open test quarantines', () => {
  const r = run('git', ['grep', '-n', '-I', '-E', 'QUARANTINE|test\\.fixme\\(', '--', 'packages', 'apps', 'packs', 'e2e', 'tests']);
  const hits = r.stdout.split(/\r?\n/).filter(Boolean).filter((l) => !l.includes('tests/harness/'));
  return hits.length === 0 || `open quarantines: ${hits.slice(0, 3).join(' | ')}`;
});

leg('check-trace --milestone M1 green', () => (exists('scripts/gates/check-trace.mjs') ? ok(node('scripts/gates/check-trace.mjs', ['--milestone', 'M1'])) : 'missing check-trace.mjs'));
leg('playwright lists 5 projects', () => {
  if (!exists('playwright.config.ts')) return 'missing playwright.config.ts';
  const r = pnpm('exec', 'playwright', 'test', '--list');
  if (r.status !== 0) return ok(r);
  const projects = new Set([...r.stdout.matchAll(/\[([\w-]+)\] ›/g)].map((m) => m[1]));
  return projects.size === 5 || `projects: ${[...projects].join(', ')}`;
});
leg('chromium smoke spec passes', () => (exists('playwright.config.ts') ? ok(pnpm('exec', 'playwright', 'test', '--project=chromium', 'e2e/smoke.studio-boots.spec.ts')) : 'missing playwright.config.ts'));
leg('storybook story test passes', () => (exists('packages/editor/.storybook') ? ok(pnpm('--filter', '@fluxion/editor', 'test:storybook')) : 'missing packages/editor/.storybook'));
leg('docs site builds with llms.txt', () => {
  if (!exists('apps/docs/astro.config.mjs')) return 'missing apps/docs/astro.config.mjs';
  const r = pnpm('--filter', '@fluxion/docs', 'build');
  if (r.status !== 0) return ok(r);
  return exists('apps/docs/dist/llms.txt') || 'apps/docs/dist/llms.txt not emitted';
});
leg('changesets configured', () => (exists('.changeset/config.json') ? ok(pnpm('changeset', 'status')) : 'missing .changeset/config.json'));
leg('workflows ci/security/nightly/release + renovate exist', () => {
  const need = ['ci.yml', 'security.yml', 'nightly.yml', 'release.yml'].map((w) => `.github/workflows/${w}`).concat('renovate.json').filter((p) => !exists(p));
  return need.length === 0 || `missing ${need.join(', ')}`;
});
leg('ci.yml has the planned job set and ci-ok needs all of them', () => {
  if (!exists('.github/workflows/ci.yml')) return 'missing ci.yml';
  const wf = readText('.github/workflows/ci.yml');
  // only 2-space keys inside the top-level `jobs:` block (not children of `on:`)
  const jobsBlock = /^jobs:\s*\n([\s\S]*?)(?=^\S|(?![\s\S]))/m.exec(wf)?.[1] ?? '';
  const jobs = [...jobsBlock.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);
  const need = ['verify', 'build', 'e2e', 'e2e-report', 'visual', 'a11y', 'size', 'api', 'license', 'eval-recorded', 'ci-ok'];
  const missing = need.filter((j) => !jobs.includes(j));
  if (missing.length) return `ci.yml missing jobs: ${missing.join(', ')}`;
  const needs = (/^ {2}ci-ok:[\s\S]*?needs:\s*\[([^\]]*)\]/m.exec(jobsBlock)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const notNeeded = jobs.filter((j) => j !== 'ci-ok' && !needs.includes(j));
  return notNeeded.length === 0 || `ci-ok does not need: ${notNeeded.join(', ')}`;
});
leg('only release.yml has id-token: write', () => {
  const wfs = ['ci.yml', 'security.yml', 'nightly.yml', 'release.yml', 'gates.yml'].filter((w) => exists(`.github/workflows/${w}`));
  const withToken = wfs.filter((w) => /id-token:\s*write/.test(readText(`.github/workflows/${w}`)));
  return (withToken.length === 1 && withToken[0] === 'release.yml') || `id-token: write in [${withToken.join(', ')}]`;
});

leg('every M1 backlog row done (reopened included)', () => checkBacklogDone(backlogTextFor('M1'), 'M1', loadMilestoneReviews('M1')));
leg('final milestone review covers M1', () => {
  const rev = json('.harness/reviews/milestone-M1-final.json');
  return rev ? checkFinalReview(rev, 'M1') : 'missing .harness/reviews/milestone-M1-final.json';
});
leg('roadmap advanced past M1', () => !['M0', 'M1'].includes(currentMilestone()) || `roadmap Current milestone is ${currentMilestone()}`);
leg('README quickstart documents pnpm setup/verify', () => /pnpm i[\s\S]*pnpm setup[\s\S]*pnpm verify/.test(readText('README.md')) || 'README.md lacks the pnpm quickstart');

await runLegs('m1');
