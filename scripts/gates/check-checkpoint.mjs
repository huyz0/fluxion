#!/usr/bin/env node
// Check the pending index or one exact CI commit, never unstaged checkpoint files.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ciEvidenceHolds, landingBlock } from './landing-block.mjs';
import { git } from './lib.mjs';

const POLICY = 'scripts/gates/check-checkpoint.mjs';
const ROADMAP = 'docs/milestones/roadmap.md';
const BACKLOG = 'docs/backlog/current.md';
const CI_EVIDENCE = '.harness/reviews/ci-evidence.json';
const taskSubject = /^M\d+\.\d+:/;
const result = (ok, detail) => ({ ok, detail: `checkpoint: ${detail}` });
const readAt = (tree, path) => {
  const r = git(['show', `${tree === 'index' ? '' : tree}:${path}`]);
  return r.status === 0 ? r.stdout : null;
};
const resolve = (ref) => {
  const r = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  return r.status === 0 ? r.stdout.trim() : null;
};
const ancestor = (a, b) => git(['merge-base', '--is-ancestor', a, b]).status === 0;
function checkedGit(args) {
  const r = git(args);
  if (r.status !== 0) throw new Error(r.stderr.trim() || `git ${args[0]} failed`);
  return r.stdout.trim();
}
function milestoneAt(commit) {
  return /\*\*Current milestone: `(M\d+)`\*\*/.exec(readAt(commit, ROADMAP) ?? '')?.[1] ?? null;
}

/** Start with the active milestone's introduction, including its plan if it changed the roadmap. */
function milestoneStart(base, milestone) {
  const history = checkedGit(['log', '--first-parent', '--reverse', '--format=%H', base, '--', ROADMAP]).split(/\r?\n/).filter(Boolean);
  const activation = history.find((sha) => milestoneAt(sha) === milestone);
  if (!activation) throw new Error(`cannot locate ${milestone} introduction`);
  const subject = checkedGit(['log', '-1', '--format=%s', activation]);
  const start = subject.startsWith(`${milestone}.`) ? resolve(`${activation}^`) : activation;
  return { activation, start };
}
function taskCount(start, base) {
  return checkedGit(['log', '--first-parent', '--format=%s', start ? `${start}..${base}` : base])
    .split(/\r?\n/)
    .filter((subject) => taskSubject.test(subject)).length;
}
function reviewPaths(tree, milestone) {
  const args =
    tree === 'index' ? ['ls-files', '--cached', '-z', '--', '.harness/reviews'] : ['ls-tree', '-r', '--name-only', '-z', tree, '--', '.harness/reviews'];
  return checkedGit(args)
    .split('\0')
    .filter((path) => path.startsWith(`.harness/reviews/milestone-${milestone}-`) && path.endsWith('.json'));
}
function findingsDisposed(review) {
  if (!Array.isArray(review.findings) || !Array.isArray(review.dispositions)) return false;
  return review.findings.every((finding) => typeof finding?.id === 'string' && review.dispositions.some((d) => dispositionFor(d, finding.id)));
}
function dispositionFor(disposition, id) {
  if (disposition?.finding !== id) return false;
  if (disposition.disposition === 'argue') return typeof disposition.note === 'string' && disposition.note.trim().length > 0;
  return ['reopen', 'hand off', 'handoff'].includes(disposition.disposition) && typeof disposition.target === 'string' && disposition.target.trim().length > 0;
}

/** A range must cover this milestone from its start and end on the actual parent history. */
function reviewEnd(review, { milestone, start, activation, base }) {
  if (review?.milestone !== milestone || typeof review.reviewer !== 'string' || !review.reviewer.trim()) return null;
  if (!findingsDisposed(review) || typeof review.checkpoint !== 'string' || !review.checkpoint.trim()) return null;
  const range = /^([a-f0-9]{7,40})\.\.([a-f0-9]{7,40})$/.exec(review.range ?? '');
  if (!range) return null;
  const from = resolve(range[1]),
    end = resolve(range[2]);
  if (!from || !end || !ancestor(from, start ?? activation) || !ancestor(activation, end) || !ancestor(end, base)) return null;
  return end;
}
function unreviewedCount(tree, context) {
  let count = taskCount(context.start, context.base);
  for (const path of reviewPaths(tree, context.milestone)) {
    let review;
    try {
      review = JSON.parse(readAt(tree, path));
    } catch {
      continue;
    }
    const end = reviewEnd(review, context);
    if (end) count = Math.min(count, taskCount(end, context.base));
  }
  return count;
}

/** Missing policy in old history is pre-adoption; removal after adoption is an error. */
function policyStatus(tree, historical) {
  if (readAt(tree, POLICY) !== null) return null;
  const adopted = historical && checkedGit(['log', '-1', '--format=%H', '--diff-filter=A', tree, '--', POLICY]);
  return historical && !adopted ? result(true, 'commit predates checkpoint policy') : result(false, 'checkpoint policy missing from proposed tree');
}

/** Like check-drift, evaluate the threshold module from the exact proposed tree. */
async function limitAt(tree) {
  const source = readAt(tree, 'scripts/gates/thresholds.mjs');
  if (source === null) throw new Error('proposed tree has no thresholds');
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  const limit = module.t('CHECKPOINT_EVERY_TASK_COMMITS');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('invalid checkpoint limit');
  return limit;
}

/**
 * Blocking rows are judged on exact commits only (CI): local commits stay allowed while a row blocks
 * landing (M18.123 r1 F1). The parent backlog decides, so a feature commit cannot clear the mark itself;
 * closing the row needs a CI record at or after the parent that check-ci-evidence holds live (M18.135).
 */
const blockedAt = (commit, base, subject, runsFile) =>
  commit && base
    ? landingBlock({
        backlog: readAt(base, BACKLOG),
        subject,
        message: checkedGit(['log', '-1', '--format=%B', commit]),
        proposed: readAt(commit, BACKLOG),
        paths: checkedGit(['diff', '--name-only', '--no-renames', base, commit]).split(/\r?\n/).filter(Boolean),
        evidence: readAt(commit, CI_EVIDENCE),
        evidenceOk: (record) => ciEvidenceHolds(record, base, { runsFile }),
      })
    : null;

/** Enforce prospectively; historical commits without the policy are exempt, deletion is not. */
export async function checkCheckpoint({ message, commit, runsFile } = {}) {
  const tree = commit ? resolve(commit) : 'index';
  if (!tree) return result(false, 'invalid commit');
  const subject = commit ? checkedGit(['log', '-1', '--format=%s', tree]) : String(message ?? '').split(/\r?\n/)[0];
  const base = commit ? resolve(`${tree}^`) : resolve('HEAD');
  // a blocking row judges every exact commit, task or not (M18.135 r1 F1)
  const blocked = blockedAt(commit, base, subject, runsFile);
  if (blocked) return result(false, blocked);
  if (!taskSubject.test(subject)) return result(true, 'not a task commit');
  const policy = policyStatus(tree, Boolean(commit));
  if (policy) return policy;
  if (!base) return result(true, 'first commit has no preceding tasks');
  const milestone = milestoneAt(base);
  if (!milestone) return result(false, 'parent roadmap has no current milestone');
  const context = { base, milestone, ...milestoneStart(base, milestone) };
  const count = unreviewedCount(tree, context);
  const limit = await limitAt(tree);
  if (count >= limit)
    return result(
      false,
      `${milestone} has ${count} unreviewed task commits (limit ${limit}); record a covering independent checkpoint (${context.start ?? context.activation}..${base}) before another task`,
    );
  return result(true, `${milestone} has ${count}/${limit} preceding unreviewed task commits`);
}

async function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const commit = arg('--commit'),
    messageFile = arg('--message'),
    runsFile = arg('--ci-runs-file'); // stands in for GitHub when a commit closes a blocking row (tests)
  if (Boolean(commit) === Boolean(messageFile)) {
    console.error('usage: check-checkpoint.mjs --message <file> | --commit <sha> [--ci-runs-file <f>]');
    process.exitCode = 2;
    return;
  }
  try {
    const verdict = await checkCheckpoint({ commit, runsFile, message: messageFile ? readFileSync(messageFile, 'utf8') : undefined });
    console.log(verdict.detail);
    process.exitCode = verdict.ok ? 0 : 1;
  } catch (error) {
    console.error(`checkpoint: ${error.message}`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
