#!/usr/bin/env node
// Non-negotiable 2: never delete or disable a test to make a gate pass.
//   check-tests-kept.mjs --msg <commit-msg-file>     (run from the commit-msg hook)
//   check-tests-kept.mjs --commit <sha>              (CI: that commit against its first parent)
// Compares each changed test file before and after, as the runner sees it (scripts/gates/
// test-titles.mjs: code only, not strings or comments). Fails when the change deletes a test file,
// removes running cases (net over the whole change), swaps a case title out, makes a test stop
// running (skip/todo/skipIf/runIf/fixme/fails, x-prefix, options, runtime skips, skipped suite) or
// focuses one (.only) — unless the message carries `Removes-test: <reason>`. Runs in commit-msg
// because the trailer only exists once the message is written.
import { readFileSync } from 'node:fs';
import { git } from './lib.mjs';
import { testTitles } from './test-titles.mjs';

// --commit <sha> (CI): use that commit's own message, so an amended or rebased commit cannot drop a
// trailer unnoticed (M0.7 review F1).
const arg = (k) => {
  const j = process.argv.indexOf(`--${k}`);
  return j >= 0 ? process.argv[j + 1] : undefined;
};
const sha = arg('commit');
const range = sha ? [`${sha}^`, sha] : ['--cached'];
const msg = sha ? git(['log', '-1', '--format=%B', sha]).stdout : arg('msg') ? readFileSync(arg('msg'), 'utf8').replace(/^#.*$/gm, '') : '';
// [ \t]* not \s*: an empty trailer followed by another trailer line must not count as a reason
const trailer = /^Removes-test:[ \t]*\S/m.test(msg);

const isTest = (p) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || (/(^|\/)(tests|e2e)\/.*\.[cm]?[jt]sx?$/.test(p) && !/(^|\/)(helpers|support|fixtures|__fixtures__)[/.]/.test(p));
const before = (p) => git(['show', `${sha ? `${sha}^` : 'HEAD'}:${p}`]);
const after = (p) => git(['show', sha ? `${sha}:${p}` : `:${p}`]);
const titlesOf = (r) => (r.status === 0 ? testTitles(r.stdout) : []);
// cases are it/test declarations; suites (describe, incl. Playwright test.describe) and steps are not
const isCase = (t) => t.kind === 'it' || t.kind === 'test';

const problems = [];
const files = [];
for (const line of git(['diff', ...range, '--name-status', '-M', '--no-color'])
  .stdout.split(/\r?\n/)
  .filter(Boolean)) {
  const [code, a, b] = line.split('\t');
  if (code === 'D' && isTest(a)) problems.push(`deletes test file ${a}`);
  if (code.startsWith('R') && isTest(a) && !isTest(b)) problems.push(`renames test file ${a} to non-test ${b}`);
  const [oldPath, newPath] = code.startsWith('R') ? [a, b] : [a, a];
  if (!isTest(oldPath) && !isTest(newPath)) continue;
  files.push({
    path: newPath,
    old: code === 'A' ? [] : titlesOf(before(oldPath)),
    now: code === 'D' || !isTest(newPath) ? [] : titlesOf(after(newPath)),
  });
}

// running cases, net over the whole change, so a case moved between files is not a removal
const running = (list) => list.filter((t) => isCase(t) && t.runs);
const oldRunning = files.flatMap((f) => running(f.old).map((t) => ({ ...t, path: f.path })));
// titles as a multiset: one surviving copy of a duplicated title must not hide the removal of
// another (M1.29 review F1)
const tally = (list) => list.reduce((m, t) => m.set(t.title, (m.get(t.title) ?? 0) + 1), new Map());
const nowRunning = tally(files.flatMap((f) => running(f.now)));
const net = oldRunning.length - files.reduce((n, f) => n + running(f.now).length, 0);
for (const f of files) {
  const drop = running(f.old).length - running(f.now).length;
  if (net > 0 && drop > 0) problems.push(`${f.path}: removes ${drop} test case(s)`);
  const stopped = f.now.filter((t) => !t.runs).length - f.old.filter((t) => !t.runs).length;
  if (stopped > 0) problems.push(`${f.path}: ${stopped} more test(s) or suite(s) do not run (skip/todo/skipIf/runIf/fixme/fails)`);
  const focused = f.now.filter((t) => t.focused).length - f.old.filter((t) => t.focused).length;
  if (focused > 0) problems.push(`${f.path}: adds ${focused} .only`);
}
// case swap: fewer running copies of a title after the change than before
const firstPath = new Map(oldRunning.toReversed().map((t) => [t.title, t.path]));
for (const [title, n] of tally(oldRunning)) {
  const left = nowRunning.get(title) ?? 0;
  if (left < n) problems.push(`${firstPath.get(title)}: case swap — test "${title}" removed and not re-added${n > 1 ? ` (${n - left} of ${n} copies)` : ''}`);
}

if (problems.length && !trailer) {
  for (const p of problems) console.error(`tests-kept: ${p}`);
  console.error('Add a "Removes-test: <reason>" trailer if this is intentional (reviewed like any change).');
  process.exit(1);
}
if (problems.length) console.log(`tests-kept: ${problems.length} removal(s) justified by Removes-test trailer`);
process.exit(0);
