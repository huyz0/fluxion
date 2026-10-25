// NFR-MNT-005: evidence must cover both current code and the final review range.
import { existsSync, readFileSync } from 'node:fs';
import { git, repoPath } from './lib.mjs';
import { AFTER_REVIEW_PATHS } from './milestone-checks.mjs';

const bookkeeping = (path) => AFTER_REVIEW_PATHS.some((pattern) => pattern.test(path));
function command(args) {
  const result = git(args);
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}
function ancestor(before, after) {
  if (git(['merge-base', '--is-ancestor', before, after]).status !== 0) throw new Error(`mutation evidence ancestry failed: ${before} -> ${after}`);
}
export function mutationProvenance(revision, milestone) {
  if (!/^[a-f0-9]{40}$/.test(revision) || !/^M[0-9]+$/.test(milestone)) throw new Error('invalid mutation evidence revision or milestone');
  const dirty = [...command(['diff', 'HEAD', '--name-only', '-z']).split('\0'), ...command(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')];
  const code = dirty.filter((path) => path && !bookkeeping(path));
  if (code.length) throw new Error(`uncommitted mutation inputs: ${code.join(', ')}`);
  const head = command(['rev-parse', 'HEAD']).trim();
  ancestor(revision, head);
  const changed = command(['diff', '--name-only', '-z', revision, head])
    .split('\0')
    .filter((path) => path && !bookkeeping(path));
  if (changed.length) throw new Error(`mutation evidence predates current code: ${changed.join(', ')}`);
  const entries = command(['log', '--format=%x01%H', '--name-only', 'HEAD']).split('\x01').filter(Boolean);
  for (const entry of entries) {
    const [sha, ...paths] = entry.split(/\r?\n/).filter(Boolean);
    if (paths.some((path) => !bookkeeping(path))) {
      ancestor(sha, revision);
      break;
    }
  }
  const review = repoPath('.harness', 'reviews', `milestone-${milestone}-final.json`);
  if (existsSync(review)) {
    const end = /\.\.([a-f0-9]{7,40})$/.exec(JSON.parse(readFileSync(review, 'utf8')).range ?? '')?.[1];
    if (!end) throw new Error('invalid final review range');
    ancestor(end, revision);
  }
  return head;
}
