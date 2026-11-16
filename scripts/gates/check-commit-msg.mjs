#!/usr/bin/env node
// commit-msg hook: node scripts/gates/check-commit-msg.mjs <msg-file> [--commit <sha>]
// Subject: "<TaskID>: <type>(<scope>)?: <summary>", TaskID = M<n>.<k> present in the backlog
// (current or archive). See docs/standards/git.md.
// A body that carries a review minor to a row ("carried to M<n>.<k>") must change that row in the same commit's backlog diff,
// and one that carries it to a row it does not name ("becomes a backlog row") must add a row (M19.53, cp6 F3). The diff is the
// staged one, or with --commit (check-commits in CI) that commit's own.
import { readFileSync } from 'node:fs';
import { exists, git, listFiles, readText } from './lib.mjs';

const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error('usage: check-commit-msg.mjs <msg-file> [--commit <sha>]');
  process.exit(2);
}
const at = process.argv.indexOf('--commit');
const commit = at > 0 ? process.argv[at + 1] : undefined;
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

// carried review minors: the rows the body names, and whether it names a row it does not say
// (a list after one "carried to" names each of its rows: "carried to M19.52, M19.42 and M19.35"). A commit committed at or before
// 43736e3, main when the rule came in, is exempt: CI re-checks from the pre-harness baseline on a branch's first push (M19.53 r1 F1).
const CARRY_RULE_AFTER_EPOCH = 1794806251;
const prose = msg.replace(/\s+/g, ' ');
const ROW = 'M\\d+\\.\\d+';
const lists = [...prose.matchAll(new RegExp(`\\bcarried (?:on )?to (?:rows? )?(${ROW}(?:(?:, | and |, and | or |/)${ROW})*)`, 'gi'))];
const named = lists.flatMap((c) => c[1].match(new RegExp(ROW, 'g')) ?? []);
const unnamed = /\bbecomes a (?:new )?backlog row\b|\bcarried (?:on )?to a new (?:backlog )?row\b/i.test(prose);
const committed = commit === undefined ? undefined : Number(git(['log', '-1', '--format=%ct', commit]).stdout.trim());
const exempt = committed !== undefined && Number.isFinite(committed) && committed > 0 && committed <= CARRY_RULE_AFTER_EPOCH;
if ((named.length > 0 || unnamed) && !exempt) {
  const backlogDiff = (args) => git([...args, '--no-color', '--no-ext-diff', '-U0', '--', 'docs/backlog/current.md']);
  const diff = backlogDiff(commit === undefined ? ['diff', '--cached'] : ['diff', `${commit}^`, commit]);
  if (diff.status !== 0) fail(`the body carries a review minor, but the backlog diff could not be read: ${diff.stderr.trim()}`);
  // an amend of the same task's commit (git.md 22) keeps the backlog change HEAD already holds: the staged diff is against HEAD (r2)
  const head = git(['log', '-1', '--format=%s', 'HEAD']);
  const amending = commit === undefined && head.status === 0 && head.stdout.startsWith(`${id}: `);
  const text = amending ? `${diff.stdout}\n${backlogDiff(['diff', 'HEAD^', 'HEAD']).stdout}` : diff.stdout;
  const rows = (sign) => new Set([...text.matchAll(new RegExp(`^\\${sign}\\| (M\\d+\\.\\d+) \\|`, 'gm'))].map((r) => r[1]));
  const [added, removed] = [rows('+'), rows('-')];
  const unchanged = [...new Set(named)].filter((id) => !added.has(id));
  if (unchanged.length > 0) fail(`the body carries a review minor to ${unchanged.join(', ')}, but this commit's backlog diff does not change that row`);
  if (unnamed && ![...added].some((id) => !removed.has(id))) fail('the body says a review minor becomes a backlog row, but this commit adds none');
}

if (/Removes-test:\s*$/m.test(msg)) fail('Removes-test: trailer needs a reason');
if (/Threshold-change:\s*$/m.test(msg)) fail('Threshold-change: trailer needs a reason');
process.exit(0);
