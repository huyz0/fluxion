#!/usr/bin/env node
// Non-negotiable 2: never delete or disable a test to make a gate pass.
//   check-tests-kept.mjs --msg <commit-msg-file>     (run from the commit-msg hook)
// Fails when the staged change deletes a test file, removes test cases, swaps a case title out, or
// adds .skip/.todo/.only/.skipIf/.runIf (also after .concurrent),
// unless the commit message carries `Removes-test: <reason>`. Runs in commit-msg (not pre-commit)
// because the trailer only exists once the message is written.
import { readFileSync } from 'node:fs';
import { git } from './lib.mjs';

// --commit <sha> (CI): check that commit against its first parent using its own message, so an
// amended or rebased commit cannot drop a trailer unnoticed (M0.7 review F1).
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
// (?<![.\w]) so method calls like /re/.test('x') are not counted as test cases
const CASE = /(?<![.\w])(?:it|test)(?:\.concurrent)?(?:\.each\([^)]*\))?\s*\(\s*([`'"])((?:\\.|(?!\1).)*)\1/;
// skipIf/runIf disable a case conditionally, which hides it on some runtime just as well (M0 cp1 F4)
const DISABLED = /(?<![.\w])(it|test|describe)(\.concurrent)?\.(skip|todo|only|skipIf|runIf)\s*\(|(?<![.\w])x(it|describe|test)\s*\(/;

const problems = [];
const status = git(['diff', ...range, '--name-status', '-M', '--no-color'])
  .stdout.split(/\r?\n/)
  .filter(Boolean);
for (const line of status) {
  const [code, a, b] = line.split('\t');
  if (code === 'D' && isTest(a)) problems.push(`deletes test file ${a}`);
  if (code.startsWith('R') && isTest(a) && !isTest(b)) problems.push(`renames test file ${a} to non-test ${b}`);
}

const diff = git(['diff', ...range, '-U0', '--no-color', '-M']).stdout.split(/\r?\n/);
let file = null;
const counts = new Map();
// case swap: a removed title that is not re-added anywhere in the change counts as a removal even
// when the per-file case count is unchanged (M0 cp1 F4)
const removedTitles = new Map();
const addedTitles = new Set();
for (const l of diff) {
  if (l.startsWith('+++ ')) {
    file = l.slice(4).replace(/^b\//, '');
    continue;
  }
  if (l.startsWith('--- ') || !file || !isTest(file)) continue;
  const c = counts.get(file) ?? { removed: 0, added: 0, disabled: 0 };
  // a commented-out case is not a case: `// it('x')` neither adds nor removes one (M1.10 review F2)
  const commented = /^[+-]\s*(\/\/|\/\*|\*)/.test(l);
  const title = commented ? undefined : CASE.exec(l)?.[2];
  if (l.startsWith('-') && title !== undefined) {
    c.removed++;
    removedTitles.set(title, file);
  }
  if (l.startsWith('+') && title !== undefined && !DISABLED.test(l)) {
    c.added++;
    addedTitles.add(title);
  }
  if (l.startsWith('+') && DISABLED.test(l)) c.disabled++;
  counts.set(file, c);
}
// net count over the whole change, so a case moved between files is not a removal; a removed case
// replaced by a different one is still caught below as a case swap
const all = [...counts.values()];
const net = all.reduce((n, c) => n + c.removed - c.added, 0);
for (const [f, c] of counts) {
  if (net > 0 && c.removed > c.added) problems.push(`${f}: removes ${c.removed - c.added} test case(s)`);
  if (c.disabled > 0) problems.push(`${f}: adds ${c.disabled} .skip/.todo/.only/.skipIf/.runIf`);
}
for (const [title, f] of removedTitles) {
  if (!addedTitles.has(title)) problems.push(`${f}: case swap — test "${title}" removed and not re-added`);
}

if (problems.length && !trailer) {
  for (const p of problems) console.error(`tests-kept: ${p}`);
  console.error('Add a "Removes-test: <reason>" trailer if this is intentional (reviewed like any change).');
  process.exit(1);
}
if (problems.length) console.log(`tests-kept: ${problems.length} removal(s) justified by Removes-test trailer`);
process.exit(0);
