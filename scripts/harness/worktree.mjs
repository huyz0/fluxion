#!/usr/bin/env node
// One git worktree per concurrent agent session (AGENTS.md "Never": two sessions, one worktree).
//   worktree.mjs create <slug>                 ../<repo>-<slug> on new branch agent/<slug>
//   worktree.mjs remove <slug> [--delete-branch]   remove the worktree; branch kept unless merged
//   worktree.mjs list
// The branch is only deleted with --delete-branch AND when already merged into HEAD's branch
// (git branch -d refuses otherwise), so unmerged agent work is never lost.
import { basename, dirname, join } from 'node:path';
import { git, REPO_ROOT } from '../gates/lib.mjs';

const [cmd, slug, ...rest] = process.argv.slice(2);
const die = (m, code = 1) => {
  console.error(`worktree: ${m}`);
  process.exit(code);
};
const ok = (r, what) => (r.status === 0 ? r : die(`${what} failed: ${r.stderr.trim()}`));

if (cmd === 'list') {
  process.stdout.write(ok(git(['worktree', 'list']), 'list').stdout);
  process.exit(0);
}
if (!['create', 'remove'].includes(cmd) || !slug) die('usage: worktree.mjs create <slug> | remove <slug> [--delete-branch] | list', 2);
if (!/^[a-z0-9][a-z0-9.-]*$/i.test(slug)) die(`invalid slug '${slug}' (letters, digits, '.', '-')`, 2);

// Anchor on the MAIN checkout (parent of the common .git dir), not the current worktree, so
// running this from inside ../fluxion-m1 still creates/removes ../fluxion-<slug>.
const common = ok(git(['rev-parse', '--path-format=absolute', '--git-common-dir']), 'git rev-parse').stdout.trim();
const main = basename(common) === '.git' ? dirname(common) : REPO_ROOT;
const path = join(dirname(main), `${basename(main)}-${slug}`);
const branch = `agent/${slug}`;

if (cmd === 'create') {
  ok(git(['worktree', 'add', path, '-b', branch]), 'git worktree add');
  console.log(`created ${path} on ${branch}\nnext: cd "${path}" && node scripts/harness/setup.mjs`);
} else {
  ok(git(['worktree', 'remove', path]), 'git worktree remove');
  console.log(`removed ${path}`);
  if (rest.includes('--delete-branch')) {
    const r = git(['branch', '-d', branch]);
    console.log(r.status === 0 ? `deleted merged branch ${branch}` : `kept ${branch} (not merged): ${r.stderr.trim()}`);
  }
}
