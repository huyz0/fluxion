#!/usr/bin/env node
// CI: re-run the message-level gates on every commit in a range, so a commit that skipped or
// amended past the local commit-msg hook is still caught (M0.7 review F1).
//   check-commits.mjs --range <base>..<head>
//   --baseline <sha>   the base used when <base> is empty or all zeros (default: the pre-harness
//                      baseline e4273a6; tests pass their own)
// Per commit: check-commit-msg (subject/task id), check-tests-kept --commit, check-drift --commit.
// Merge commits are skipped (their parents are checked individually). gates.yml passes the event's
// base as is: a branch's first push has an all-zero `before`, and commits up to the pre-harness
// baseline are exempt, so both fall back to it here instead of in workflow shell (M1 final F5).
import { mkdirSync, writeFileSync } from 'node:fs';
import { git, node, repoPath } from './lib.mjs';

const opt = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const BASELINE = opt('baseline') ?? 'e4273a6';
const given = opt('range');
if (!given?.includes('..')) {
  console.error('usage: check-commits.mjs --range <base>..<head> [--baseline <sha>]');
  process.exit(2);
}
const cut = given.indexOf('..');
const base = given.slice(0, cut);
const unknownBase = base === '' || /^0+$/.test(base);
const range = unknownBase ? `${BASELINE}..${given.slice(cut + 2)}` : given;
if (unknownBase) console.log(`check-commits: base "${base}" is empty or all zeros; checking from the baseline ${BASELINE}`);
const list = git(['rev-list', '--no-merges', '--reverse', range]);
if (list.status !== 0) {
  console.error(`check-commits: bad range ${range}: ${list.stderr.trim()}`);
  process.exit(2);
}
const shas = list.stdout.split(/\r?\n/).filter(Boolean);
mkdirSync(repoPath('.harness', 'tmp'), { recursive: true });
const msgFile = repoPath('.harness', 'tmp', 'ci-commit-msg');

let failed = 0;
for (const sha of shas) {
  writeFileSync(msgFile, git(['log', '-1', '--format=%B', sha]).stdout);
  const subject = git(['log', '-1', '--format=%s', sha]).stdout.trim();
  const results = [
    ['commit-msg', node('scripts/gates/check-commit-msg.mjs', [msgFile])],
    ['tests-kept', node('scripts/gates/check-tests-kept.mjs', ['--commit', sha])],
    ['drift', node('scripts/gates/check-drift.mjs', ['--commit', sha])],
  ];
  const bad = results.filter(([, r]) => r.status !== 0);
  if (bad.length) failed++;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${sha.slice(0, 8)} ${subject}`);
  for (const [name, r] of bad) console.log(`    ${name}: ${(r.stderr || r.stdout).trim().split(/\r?\n/).join(' | ')}`);
}
console.log(`check-commits: ${shas.length - failed}/${shas.length} commits pass (${range})`);
process.exit(failed ? 1 : 0);
