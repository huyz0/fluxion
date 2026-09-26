#!/usr/bin/env node
// Completion gate for M0 — Harness bootstrap & verification (docs/milestones/M0.md).
// Written first and red. Each leg is a statement of what is left.
import { exists, leg, node, readText, run, runLegs } from './lib.mjs';

const ok = (r) => (r.status === 0 ? true : `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`);

leg('node >= 22', () => Number(process.versions.node.split('.')[0]) >= 22 || `node ${process.versions.node}`);
leg('git repository with hooksPath=.githooks', () => {
  const r = run('git', ['config', '--get', 'core.hooksPath']);
  return r.stdout.trim() === '.githooks' || 'run node scripts/harness/setup.mjs';
});
leg('skill adapters in sync', () => ok(node('scripts/harness/sync-skills.mjs', ['--check'])));
leg('portability', () => ok(node('scripts/gates/check-portability.mjs')));

const M0_SCRIPTS = [
  'scripts/gates/check-size.mjs',
  'scripts/gates/check-tests-kept.mjs',
  'scripts/gates/check-drift.mjs',
  'scripts/harness/build-index.mjs',
  'scripts/harness/stop-check.mjs',
  'scripts/harness/worktree.mjs',
];
for (const s of M0_SCRIPTS) leg(`exists ${s}`, () => exists(s) || 'missing');

leg('harness negative tests', () => {
  if (!exists('tests/harness')) return 'tests/harness missing';
  return ok(run(process.execPath, ['--test', 'tests/harness/*.test.mjs']));
});
leg('index tables current', () => (exists('scripts/harness/build-index.mjs') ? ok(node('scripts/harness/build-index.mjs', ['--check'])) : 'build-index.mjs missing'));
leg('precommit --all green', () => ok(node('scripts/gates/precommit.mjs', ['--all', '--summary'])));
leg('CI gates workflow', () => exists('.github/workflows/gates.yml') || 'missing .github/workflows/gates.yml');
leg('codex adapter config', () => exists('.codex') || 'missing .codex/');
leg('dry runs documented (claude + codex, success + impossible)', () => {
  if (!exists('docs/harness/dry-runs.md')) return 'missing docs/harness/dry-runs.md';
  const t = readText('docs/harness/dry-runs.md').toLowerCase();
  const need = ['claude', 'codex', 'success', 'impossible'].filter((w) => !t.includes(w));
  return need.length === 0 || `missing sections: ${need.join(', ')}`;
});
leg('harness guide', () => exists('docs/harness/README.md') || 'missing docs/harness/README.md');
leg('milestone review recorded', () => exists('.harness/reviews/milestone-M0-final.json') || 'missing .harness/reviews/milestone-M0-final.json');

await runLegs('m0');
