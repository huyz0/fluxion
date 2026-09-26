#!/usr/bin/env node
// Non-negotiable 2: never delete or disable a test to make a gate pass.
//   check-tests-kept.mjs --msg <commit-msg-file>     (run from the commit-msg hook)
// Fails when the staged change deletes a test file, removes test cases, or adds .skip/.todo/.only,
// unless the commit message carries `Removes-test: <reason>`. Runs in commit-msg (not pre-commit)
// because the trailer only exists once the message is written.
import { readFileSync } from 'node:fs';
import { git } from './lib.mjs';

const i = process.argv.indexOf('--msg');
const msg = i >= 0 ? readFileSync(process.argv[i + 1], 'utf8').replace(/^#.*$/gm, '') : '';
// [ \t]* not \s*: an empty trailer followed by another trailer line must not count as a reason
const trailer = /^Removes-test:[ \t]*\S/m.test(msg);

const isTest = (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(tests|e2e)\/.*\.[cm]?[jt]sx?$/.test(p) && !/(^|\/)(helpers|support|fixtures|__fixtures__)[/.]/.test(p);
// (?<![.\w]) so method calls like /re/.test('x') are not counted as test cases
const CASE = /(?<![.\w])(it|test)(\.each\([^)]*\))?\s*\(\s*[`'"]/;
const DISABLED = /(?<![.\w])(it|test|describe)\.(skip|todo|only)\s*\(|(?<![.\w])x(it|describe)\s*\(/;

const problems = [];
const status = git(['diff', '--cached', '--name-status', '-M', '--no-color']).stdout.split(/\r?\n/).filter(Boolean);
for (const line of status) {
  const [code, a, b] = line.split('\t');
  if (code === 'D' && isTest(a)) problems.push(`deletes test file ${a}`);
  if (code.startsWith('R') && isTest(a) && !isTest(b)) problems.push(`renames test file ${a} to non-test ${b}`);
}

const diff = git(['diff', '--cached', '-U0', '--no-color', '-M']).stdout.split(/\r?\n/);
let file = null;
const counts = new Map();
for (const l of diff) {
  if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, ''); continue; }
  if (l.startsWith('--- ') || !file || !isTest(file)) continue;
  const c = counts.get(file) ?? { removed: 0, added: 0, disabled: 0 };
  if (l.startsWith('-') && CASE.test(l)) c.removed++;
  if (l.startsWith('+') && CASE.test(l) && !DISABLED.test(l)) c.added++;
  if (l.startsWith('+') && DISABLED.test(l)) c.disabled++;
  counts.set(file, c);
}
for (const [f, c] of counts) {
  if (c.removed > c.added) problems.push(`${f}: removes ${c.removed - c.added} test case(s)`);
  if (c.disabled > 0) problems.push(`${f}: adds ${c.disabled} .skip/.todo/.only`);
}

if (problems.length && !trailer) {
  for (const p of problems) console.error(`tests-kept: ${p}`);
  console.error('Add a "Removes-test: <reason>" trailer if this is intentional (reviewed like any change).');
  process.exit(1);
}
if (problems.length) console.log(`tests-kept: ${problems.length} removal(s) justified by Removes-test trailer`);
process.exit(0);
