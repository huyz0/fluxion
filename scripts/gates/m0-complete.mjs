#!/usr/bin/env node
// Completion gate for M0 — Harness bootstrap & verification (docs/milestones/M0.md).
// Legs are behavioural (M0 cp1 F1): a stub script, an empty .codex/, a one-sentence dry-runs
// file or an unparsed review cannot turn a leg green. Each red leg states what is left.
import { existsSync, readFileSync } from 'node:fs';
import { currentMilestone, exists, leg, node, readText, repoPath, run, runLegs } from './lib.mjs';
import { checkDryRuns, checkFinalReview, checkHooksExecutable, checkReviewerSmoke } from './milestone-checks.mjs';
import { t } from './thresholds.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
const json = (p) => (existsSync(repoPath(p)) ? JSON.parse(readFileSync(repoPath(p), 'utf8')) : null);
const timed = (fn) => { const t0 = Date.now(); const r = fn(); return { r, ms: Date.now() - t0 }; };

leg('node >= 22', () => Number(process.versions.node.split('.')[0]) >= 22 || `node ${process.versions.node}`);
leg('git hooks installed (hooksPath=.githooks) and executable', () => {
  if (run('git', ['config', '--get', 'core.hooksPath']).stdout.trim() !== '.githooks') return 'run node scripts/harness/setup.mjs';
  return checkHooksExecutable();
});
leg('skill adapters in sync', () => ok(node('scripts/harness/sync-skills.mjs', ['--check'])));
leg('portability', () => ok(node('scripts/gates/check-portability.mjs')));
leg('index tables current', () => ok(node('scripts/harness/build-index.mjs', ['--check'])));

// Every M0 deliverable must exist AND have a behavioural test in the suite (next leg runs it).
const BEHAVIOUR = {
  'scripts/gates/check-size.mjs': 'tests/harness/size.test.mjs',
  'scripts/gates/check-tests-kept.mjs': 'tests/harness/tests-kept.test.mjs',
  'scripts/gates/check-drift.mjs': 'tests/harness/drift.test.mjs',
  'scripts/gates/check-commits.mjs': 'tests/harness/ci-workflow.test.mjs',
  'scripts/gates/check-reviewed.mjs': 'tests/harness/review.test.mjs',
  'scripts/harness/build-index.mjs': 'tests/harness/build-index.test.mjs',
  'scripts/harness/stop-check.mjs': 'tests/harness/stop-check.test.mjs',
  'scripts/harness/worktree.mjs': 'tests/harness/worktree.test.mjs',
  '.github/workflows/gates.yml': 'tests/harness/ci-workflow.test.mjs',
  '.codex/hooks.json': 'tests/harness/adapters.test.mjs',
};
for (const [deliverable, test] of Object.entries(BEHAVIOUR)) {
  leg(`${deliverable} has behavioural test`, () => (exists(deliverable) ? exists(test) || `missing ${test}` : 'missing'));
}
leg('harness test suite passes', () => ok(run(process.execPath, ['--test', 'tests/harness/*.test.mjs'])));
leg('codex hooks enabled', () => /^hooks = true$/m.test(exists('.codex/config.toml') ? readText('.codex/config.toml') : '') || '.codex/config.toml lacks [features] hooks = true');

// NFR-DX-002: gate latency within budget (precommit --all includes the harness suite).
leg(`quick gate < ${t('QUICK_GATE_BUDGET_MS')}ms`, () => {
  const { r, ms } = timed(() => node('scripts/gates/precommit.mjs', ['--quick', '--summary']));
  return r.status !== 0 ? ok(r) : ms < t('QUICK_GATE_BUDGET_MS') || `${ms}ms`;
});
leg(`precommit --all green < ${t('PRECOMMIT_BUDGET_MS')}ms`, () => {
  const { r, ms } = timed(() => node('scripts/gates/precommit.mjs', ['--all', '--summary']));
  return r.status !== 0 ? ok(r) : ms < t('PRECOMMIT_BUDGET_MS') || `${ms}ms`;
});

// Human-dependent evidence (M0.13–M0.15): real runs, recorded in a checkable shape.
leg('cross-vendor reviewer smoke recorded (M0.13)', () => {
  const rec = json('.harness/reviews/cross-vendor-smoke.json');
  const digest = exists('.harness/reviews/digest.log') ? readText('.harness/reviews/digest.log') : '';
  return rec ? checkReviewerSmoke(rec, digest) : 'missing .harness/reviews/cross-vendor-smoke.json';
});
leg('dry runs recorded per tool: success + impossible (M0.14, M0.15)', () =>
  (exists('docs/harness/dry-runs.md') ? checkDryRuns(readText('docs/harness/dry-runs.md')) : 'missing docs/harness/dry-runs.md'));

leg('operator guide linked from AGENTS.md', () => {
  if (!exists('docs/harness/README.md')) return 'missing docs/harness/README.md';
  return readText('AGENTS.md').includes('(docs/harness/README.md)') || 'AGENTS.md does not link docs/harness/README.md';
});
leg('final milestone review covers M0 (M0.18)', () => {
  const rev = json('.harness/reviews/milestone-M0-final.json');
  return rev ? checkFinalReview(rev, 'M0') : 'missing .harness/reviews/milestone-M0-final.json';
});
leg('roadmap advanced past M0', () => currentMilestone() !== 'M0' || 'roadmap Current milestone is still M0');

await runLegs('m0');
