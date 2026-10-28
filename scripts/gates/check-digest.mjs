#!/usr/bin/env node
// Durable review evidence for every task commit of the active milestone (M18.99, ADR-0195).
//   check-digest.mjs            committed history up to HEAD, with the staged tree's digest and backlog
//   check-digest.mjs --head     the same against HEAD's own tree (CI and completion gates)
//   --full-history              fail, not skip, on a shallow clone (completion gates must judge history)
// From the commit that adopted this gate on, each task commit must carry, in its own tree, a pass
// digest line for its task bound to its own content identity. Earlier task commits need a pass line
// for their task in the evaluated digest, or a reviewed exemption in .harness/baselines/digest-exempt.txt.
// A done backlog row needs its Commit cell once a later commit exists to record it. A posthoc line
// (reviewer `...:posthoc`) that names a content identity must match one of its task's commits
// (M18.119): a posthoc review binds to what landed, not to a diff that never did. A `rebind` line
// counts only when it names a pass line of its task, and a pass line a commit adds for other content
// must be followed by a later line of its task (M18.127).
// CI (gates.yml) runs `--head --full-history` on every push and PR.
import { pathToFileURL } from 'node:url';
import { git } from './lib.mjs';
import { contentIds, isPosthoc, parseDigest, parseReviewer, reviewedDiffHash } from './review-content.mjs';

const POLICY = 'scripts/gates/check-digest.mjs';
const ROADMAP = 'docs/milestones/roadmap.md';
const DIGEST = '.harness/reviews/digest.log';
const EXEMPT = '.harness/baselines/digest-exempt.txt';
const BACKLOG = 'docs/backlog/current.md';
/** The task whose commit made review.mjs write only `vendor:role[:posthoc]` reviewers (M18.141). */
const GRAMMAR_SINCE = 'M18.127';

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
    if (adopted && atOrAfter(sha, adopted)) problems.push(...boundProblems(sha, task).map((p) => `${short} ${task}: ${p}`));
    else if (!passed.has(task) && !exempt.has(`${short} ${task}`)) problems.push(`${short} ${task}: no tracked pass digest line and no exemption`);
  }
  return problems;
}

/** A post-adoption commit needs a pass (or rebind) line bound to its content and no stale pass. */
function boundProblems(sha, task) {
  const ids = contentIds(sha);
  const content = ids[0];
  if (!content) return [];
  const own = parseDigest(show(sha, DIGEST));
  let hash;
  const diffHash = () => (hash ??= reviewedDiffHash(sha));
  const covers = (l) => l.task === task && ids.includes(l.content) && binds(l, own, diffHash);
  const problems = own.some(covers) ? [] : [`its tree has no pass digest line bound to its content ${content.slice(0, 12)}`];
  return [...problems, ...stalePasses(sha, { task, ids, own, covers })];
}

/**
 * A pass line, or a `rebind` line naming a pass line of the same task that reviewed this commit's
 * exact diff, as `review.mjs rebind` checks: a hand-written rebind binds nothing (M18.127 r1 F2).
 */
function binds(line, digest, diffHash) {
  if (line.verdict === 'pass') return true;
  const bound = line.verdict === 'rebind' ? digest[line.bound - 1] : undefined;
  return bound?.task === line.task && bound.verdict === 'pass' && bound.hash === line.hash && line.hash === diffHash();
}

/**
 * Pass lines this commit added for its task that bind other content, with no later line binding
 * this commit's content: the digest would show a pass for a diff that did not land (M18.127, cp13 F5).
 */
function stalePasses(sha, { task, ids, own, covers }) {
  const before = new Set(show(`${sha}^`, DIGEST).split(/\r?\n/));
  const text = show(sha, DIGEST).split(/\r?\n/).filter(Boolean);
  return own
    .map((l, i) => ({ l, i, added: !before.has(text[i]) }))
    .filter(({ l, i, added }) => added && l.task === task && l.verdict === 'pass' && l.content && !ids.includes(l.content) && !own.slice(i + 1).some(covers))
    .map(
      ({ l, i }) => `digest line ${i + 1} is a pass for content ${l.content.slice(0, 12)}, not this commit's, and no later line binds this commit's content`,
    );
}

/**
 * The digest's lines as { text, line }, each marked `old` when it was already in the digest before
 * GRAMMAR_SINCE's commit: only those may keep a free-form reviewer (M18.141, cp16 F1).
 */
function digestLines(tree) {
  const since = lines(git(['log', '--first-parent', '--reverse', '--format=%H', '--grep', `^${GRAMMAR_SINCE.replace('.', '\\.')}:`, 'HEAD']))[0];
  const before = new Set(since ? show(`${since}^`, DIGEST).split(/\r?\n/) : []);
  const texts = show(tree, DIGEST).split(/\r?\n/).filter(Boolean);
  return parseDigest(texts.join('\n')).map((line, i) => ({ line, n: i + 1, old: before.has(texts[i]) }));
}

/** Lines added since the grammar whose reviewer is not `vendor:role[:posthoc]`. */
function grammarProblems(entries) {
  return entries
    .filter(({ line, old }) => !old && !parseReviewer(line.reviewer))
    .map(({ line, n }) => `digest line ${n} (${line.task}): reviewer '${line.reviewer}' is not vendor:role[:posthoc] (${GRAMMAR_SINCE})`);
}

/** Posthoc pass lines of `milestone` whose content identity matches none of their task's commits. */
function posthocProblems(commits, entries, milestone) {
  const ids = new Map();
  const idsOf = (task) => {
    if (!ids.has(task)) ids.set(task, new Set(commits.filter((c) => c.task === task).flatMap((c) => contentIds(c.sha))));
    return ids.get(task);
  };
  // the grammar alone decides for lines added since it; the regex fallback is for older lines only
  const posthoc = ({ line, old }) => (old ? isPosthoc(line.reviewer) : parseReviewer(line.reviewer)?.posthoc);
  return entries
    .filter((e) => posthoc(e) && e.line.content && e.line.task?.startsWith(`${milestone}.`))
    .map(({ line }) => line)
    .filter((l) => !idsOf(l.task).has(l.content))
    .map((l) => `${l.task}: posthoc digest line names content ${l.content.slice(0, 12)}, which no ${l.task} commit has`);
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
export function checkDigest({ tree = 'index', fullHistory = false } = {}) {
  // a checkout without history or a roadmap (partial harness sandboxes) has nothing to cover
  if (git(['rev-parse', '--verify', 'HEAD']).status !== 0) return { ok: true, detail: 'digest: SKIP — no committed history' };
  // a shallow clone (CI's depth-1 checkout) cannot see the history this gate judges; the local
  // ladder and the completion gate run it on full history
  if (git(['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true')
    return fullHistory
      ? { ok: false, detail: 'digest: shallow clone; fetch full history (git fetch --unshallow) to judge review evidence' }
      : { ok: true, detail: 'digest: SKIP — shallow clone has no task history' };
  const roadmap = show('HEAD', ROADMAP);
  if (!roadmap) return { ok: true, detail: 'digest: SKIP — no committed roadmap' };
  const milestone = /\*\*Current milestone: `(M\d+)`\*\*/.exec(roadmap)?.[1];
  if (!milestone) return { ok: false, detail: 'digest: roadmap has no current milestone' };
  const commits = taskCommits(milestone);
  const entries = digestLines(tree);
  const problems = [
    ...evidenceProblems(commits, tree, adoption()),
    ...grammarProblems(entries),
    ...posthocProblems(commits, entries, milestone),
    ...commitCellProblems(commits, tree),
  ];
  if (problems.length) return { ok: false, detail: `digest: ${problems.length} problem(s)\n  ${problems.join('\n  ')}` };
  return { ok: true, detail: `digest: ${commits.length} ${milestone} task commits have tracked review evidence and Commit cells` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const verdict = checkDigest({ tree: process.argv.includes('--head') ? 'HEAD' : 'index', fullHistory: process.argv.includes('--full-history') });
  (verdict.ok ? console.log : console.error)(verdict.detail);
  process.exitCode = verdict.ok ? 0 : 1;
}
