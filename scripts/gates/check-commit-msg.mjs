#!/usr/bin/env node
// commit-msg hook: node scripts/gates/check-commit-msg.mjs <msg-file>
// Subject: "<TaskID>: <type>(<scope>)?: <summary>", TaskID = M<n>.<k> present in the backlog
// (current or archive). See docs/standards/git.md.
import { readFileSync } from 'node:fs';
import { exists, listFiles, readText } from './lib.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: check-commit-msg.mjs <msg-file>');
  process.exit(2);
}
const msg = readFileSync(file, 'utf8').replace(/^#.*$/gm, '').trim();
const subject = msg.split(/\r?\n/)[0] ?? '';

if (/^(Merge|Revert) /.test(subject) || /^(fixup|squash|amend)! /.test(subject)) process.exit(0);

const TYPES = 'feat|fix|refactor|perf|test|docs|build|ci|chore|style|revert';
const re = new RegExp(`^(M\\d+\\.\\d+): (${TYPES})(\\([a-z0-9-]+\\))?!?: \\S.{0,90}$`);
const m = re.exec(subject);
const fail = (why) => {
  console.error(`commit-msg: ${why}\n  subject: ${subject}\n  expected: M3.4: feat(core): add transaction merging`);
  process.exit(1);
};
if (!m) fail('subject does not match "<TaskID>: <type>(<scope>): <summary>" (≤ ~100 chars)');

const id = m[1];
const backlogs = ['docs/backlog/current.md', ...listFiles('docs/backlog/archive', (p) => p.endsWith('.md'))].filter(exists).map(readText).join('\n');
if (!new RegExp(`\\|\\s*${id.replace('.', '\\.')}\\s*\\|`).test(backlogs)) fail(`task ${id} not found in docs/backlog`);

if (/Removes-test:\s*$/m.test(msg)) fail('Removes-test: trailer needs a reason');
if (/Threshold-change:\s*$/m.test(msg)) fail('Threshold-change: trailer needs a reason');
process.exit(0);
