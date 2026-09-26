#!/usr/bin/env node
// Nightly failures do not block PRs; they open (or update) one issue that the next milestone plan
// must dispose of (ci-cd.md section 3). Keyed by title, so no label has to exist first.
//   nightly-issue.mjs              needs GH_TOKEN, GH_REPO; RUN_URL, NEEDS (toJSON(needs))
//   nightly-issue.mjs --dry-run    print the gh commands instead; NIGHTLY_EXISTING=<number> fakes
//                                  an open issue (tests)
import { spawnSync } from 'node:child_process';

const TITLE = 'Nightly failure';
const dry = process.argv.includes('--dry-run');
const needs = JSON.parse(process.env.NEEDS || '{}');
const failed = Object.entries(needs)
  .filter(([, j]) => j?.result !== 'success')
  .map(([name, j]) => `${name} (${j?.result})`);
const body = [
  `Nightly run failed: ${process.env.RUN_URL ?? '(run url unknown)'}`,
  `Failed jobs: ${failed.join(', ') || '(unknown)'}`,
  '',
  'Dispose of this in the next milestone plan: a fix row, or a recorded deferral.',
].join('\n');

const gh = (args) => {
  if (dry) {
    console.log(`gh ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    return '';
  }
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`nightly-issue: gh ${args[0]} ${args[1]} failed\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
};

const listed = gh(['issue', 'list', '--state', 'open', '--search', `in:title "${TITLE}"`, '--json', 'number,title']);
const open = dry ? (process.env.NIGHTLY_EXISTING ? [{ number: Number(process.env.NIGHTLY_EXISTING), title: TITLE }] : []) : JSON.parse(listed || '[]');
// the search is fuzzy: only an exact title counts as the nightly issue
const existing = open.find((i) => i.title === TITLE);
if (existing) gh(['issue', 'comment', String(existing.number), '--body', body]);
else gh(['issue', 'create', '--title', TITLE, '--body', body]);
console.log(`nightly-issue: ${existing ? `commented on #${existing.number}` : 'opened a new issue'}`);
