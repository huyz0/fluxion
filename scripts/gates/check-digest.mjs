#!/usr/bin/env node
// Durable review evidence for every task commit of the active milestone (M18.99, ADR-0195).
//   check-digest.mjs            committed history up to HEAD, with the staged tree's digest and backlog
//   check-digest.mjs --head     the same against HEAD's own tree (CI and completion gates)
// From the commit that adopted this gate on, each task commit must carry, in its own tree, a pass
// digest line for its task bound to its own content identity. Earlier task commits need a pass line
// for their task in the evaluated digest, or a reviewed exemption in .harness/baselines/digest-exempt.txt.
// A done backlog row needs its Commit cell once a later commit exists to record it.
import { pathToFileURL } from 'node:url';
import { git } from './lib.mjs';
import { contentId, parseDigest } from './review-content.mjs';

const POLICY = 'scripts/gates/check-digest.mjs';
const ROADMAP = 'docs/milestones/roadmap.md';
const DIGEST = '.harness/reviews/digest.log';
const EXEMPT = '.harness/baselines/digest-exempt.txt';
const BACKLOG = 'docs/backlog/current.md';

const show = (tree, path) => {
  const r = git(['show', `${tree === 'index' ? '' : tree}:${path}`]);
  return r.status === 0 ? r.stdout : '';
};
const lines = (r) => r.stdout.split(/\r?\n/).filter(Boolean);

/** Commits (oldest first) whose subject names a task of `milestone`, on HEAD's first-parent history. */
function taskCommits(milestone) {
  return lines(git(['log', '--first-parent', '--reverse', '--format=%H %s', 'HEAD']))
    .map((l) => /^(\w+) ((M\d+)\.\d+):/.exec(l))
    .filter((m) => m && m[3] === milestone)
    .map((m) => ({ sha: m[1], task: m[2] }));
}

/** The first commit that added this gate, or null before adoption. */
function adoption() {
  return lines(git(['log', '--first-parent', '--reverse', '--diff-filter=A', '--format=%H', 'HEAD', '--', POLICY]))[0] ?? null;
}
const atOrAfter = (sha, base) => git(['merge-base', '--is-ancestor', base, sha]).status === 0;

/** `<sha7+> <task> <reason>` lines: reviewed decisions that a commit's evidence cannot be recovered. */
function exemptions(tree) {
  return new Set(
    show(tree, EXEMPT)
      .split(/\r?\n/)
      .map((l) => /^([0-9a-f]{7,40})\s+(M\d+\.\d+)\s+\S/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => `${m[1].slice(0, 7)} ${m[2]}`),
  );
}

function evidenceProblems(commits, tree, adopted) {
  const digest = parseDigest(show(tree, DIGEST));
  const passed = new Set(digest.filter((l) => l.verdict === 'pass').map((l) => l.task));
  const exempt = exemptions(tree);
  const problems = [];
  for (const { sha, task } of commits) {
    const short = sha.slice(0, 7);
    if (adopted && atOrAfter(sha, adopted)) {
      const content = contentId(sha);
      const own = parseDigest(show(sha, DIGEST));
      if (content && !own.some((l) => l.task === task && l.verdict === 'pass' && l.content === content))
        problems.push(`${short} ${task}: its tree has no pass digest line bound to its content ${content.slice(0, 12)}`);
    } else if (!passed.has(task) && !exempt.has(`${short} ${task}`)) problems.push(`${short} ${task}: no tracked pass digest line and no exemption`);
  }
  return problems;
}

/**
 * Done rows with an empty Commit cell. Checking HEAD's own tree, HEAD's row may stay empty (no
 * commit can name itself); checking the index, the pending commit is the later one that must fill it.
 */
function commitCellProblems(commits, tree) {
  const head = tree === 'index' ? null : git(['rev-parse', 'HEAD']).stdout.trim();
  const committed = new Map(commits.map((c) => [c.task, c.sha]));
  const problems = [];
  for (const line of show(tree, BACKLOG).split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    const id = /^M\d+\.\d+$/.exec(cells[1] ?? '')?.[0];
    if (!id || !/^done\b/.test(cells[6] ?? '') || cells[7]) continue;
    const sha = committed.get(id);
    if (sha && sha !== head) problems.push(`${id}: done since ${sha.slice(0, 7)} but its Commit cell is empty`);
  }
  return problems;
}

/** Check one tree ('index' or 'HEAD') against the active milestone's committed task history. */
export function checkDigest({ tree = 'index' } = {}) {
  // a checkout without history or a roadmap (partial harness sandboxes) has nothing to cover
  if (git(['rev-parse', '--verify', 'HEAD']).status !== 0) return { ok: true, detail: 'digest: SKIP — no committed history' };
  // a shallow clone (CI's depth-1 checkout) cannot see the history this gate judges; the local
  // ladder and the completion gate run it on full history
  if (git(['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true') return { ok: true, detail: 'digest: SKIP — shallow clone has no task history' };
  const roadmap = show('HEAD', ROADMAP);
  if (!roadmap) return { ok: true, detail: 'digest: SKIP — no committed roadmap' };
  const milestone = /\*\*Current milestone: `(M\d+)`\*\*/.exec(roadmap)?.[1];
  if (!milestone) return { ok: false, detail: 'digest: roadmap has no current milestone' };
  const commits = taskCommits(milestone);
  const problems = [...evidenceProblems(commits, tree, adoption()), ...commitCellProblems(commits, tree)];
  if (problems.length) return { ok: false, detail: `digest: ${problems.length} problem(s)\n  ${problems.join('\n  ')}` };
  return { ok: true, detail: `digest: ${commits.length} ${milestone} task commits have tracked review evidence and Commit cells` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const verdict = checkDigest({ tree: process.argv.includes('--head') ? 'HEAD' : 'index' });
  (verdict.ok ? console.log : console.error)(verdict.detail);
  process.exitCode = verdict.ok ? 0 : 1;
}
