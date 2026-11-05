#!/usr/bin/env node
// Durable review evidence for every task commit of the active milestone (M18.99, ADR-0195).
//   check-digest.mjs            committed history up to HEAD, with the staged tree's digest and backlog
//   check-digest.mjs --head     the same against HEAD's own tree (CI and completion gates)
//   --full-history              fail, not skip, on a shallow clone (completion gates must judge history)
//   check-digest.mjs --message <file>   the commit-msg hook: the message of the commit being made names no review round its staged
//                                       digest lines do not hold (M18.259)
// From the commit that adopted this gate on, each task commit must carry, in its own tree, a pass
// digest line for its task bound to its own content identity. Earlier task commits need a pass line
// for their task in the evaluated digest, or a reviewed exemption in .harness/baselines/digest-exempt.txt.
// A done backlog row needs its Commit cell once a later commit exists to record it, naming a commit of that row on HEAD's
// history (M18.207). A posthoc line
// (reviewer `...:posthoc`) that names a content identity must match one of its task's commits
// (M18.119): a posthoc review binds to what landed, not to a diff that never did. A `rebind` line
// counts only when it names a pass line of its task, and a pass line a commit adds for other content
// must be followed by a later line of its task (M18.127).
// A staged commit that changes state.json's currentTask or blockedReason, or any backlog row's State, must move state.json's
// `updated` past HEAD's (M18.266, cp42 F3).
// CI (gates.yml) runs `--head --full-history` on every push and PR.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { git } from './lib.mjs';
import { contentIds, isPosthoc, missingRounds, namedRounds, openLines, parseDigest, parseReviewer, reviewedDiffHash } from './review-content.mjs';

const POLICY = 'scripts/gates/check-digest.mjs';
const ROADMAP = 'docs/milestones/roadmap.md';
const DIGEST = '.harness/reviews/digest.log';
const EXEMPT = '.harness/baselines/digest-exempt.txt';
/** `<sha7+> <task> <reason>`: a landed commit whose message names rounds its lines lack, excused by a reviewed decision (M18.259 r4 F1). */
const ROUNDS_EXEMPT = '.harness/baselines/named-rounds-exempt.txt';
const BACKLOG = 'docs/backlog/current.md';
/** The task whose commit made review.mjs write only `vendor:role[:posthoc]` reviewers (M18.141). */
const GRAMMAR_SINCE = 'M18.127';
/** The task whose commit made a commit's digest lines name only its own task (M18.231, cp34 F2). */
const OWN_LINES_SINCE = 'M18.231';
/** The task whose commit made a commit's body and its digest lines agree on the review rounds held (M18.259, cp40 F1). */
const ROUNDS_SINCE = 'M18.259';
const PROGRESS = '.harness/progress.md';
const STATE = '.harness/state.json';

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
function exemptions(tree, file = EXEMPT) {
  return new Set(
    show(tree, file)
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

/** Why a done row's filled Commit cell names no commit of that row on HEAD's history (`history`: sha and subject), or undefined. */
function cellProblem(id, cell, history) {
  const named = /^[0-9a-f]{7,40}$/.test(cell) ? history.filter((c) => c.sha.startsWith(cell)) : [];
  if (!named.length) return `${id}: Commit cell ${cell} is not a commit on HEAD's history`;
  if (named.some((c) => c.subject.startsWith(`${id}:`))) return undefined;
  return `${id}: Commit cell ${cell} is a commit of another task (${named[0]?.subject.split(':')[0]})`;
}

/**
 * Done rows with an empty Commit cell, and filled cells that name no landed commit of their row (M18.207, cp29 F1): the sha must
 * be a commit on HEAD's history whose subject begins with the row's id. Checking HEAD's own tree, HEAD's row may stay empty (no
 * commit can name itself); checking the index, the pending commit is the later one that must fill it.
 */
function commitCellProblems(commits, tree) {
  const head = tree === 'index' ? null : git(['rev-parse', 'HEAD']).stdout.trim();
  const committed = new Map(commits.map((c) => [c.task, c.sha]));
  const history = lines(git(['log', '--format=%H %s', 'HEAD'])).map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) }));
  return show(tree, BACKLOG)
    .split(/\r?\n/)
    .map((line) => rowCellProblem(line, { committed, head, history }))
    .filter(Boolean);
}

/**
 * The backlog header's `current: N` against its `| M<n>.<k> |` rows (M18.223, cp32 F5): a row added without the count, or a
 * count bumped without a row, is a problem. A backlog without the header has nothing to compare.
 */
export function headerCountProblems(text) {
  const stated = /^Planned: \d+ rows; current: (\d+)\b/m.exec(text)?.[1];
  if (stated === undefined) return [];
  const rows = text.split(/\r?\n/).filter((l) => /^\| M\d+\.\d+ \|/.test(l)).length;
  return Number(stated) === rows ? [] : [`backlog header says current: ${stated} but it has ${rows} rows; correct the header`];
}

/** Each backlog row's State by its id. */
function rowStates(text) {
  const states = new Map();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    const id = /^M\d+\.\d+$/.exec(cells[1] ?? '')?.[0];
    if (id && cells.length >= 9) states.set(id, cells[6]);
  }
  return states;
}

/** How far ahead of the commit being made state.json's `updated` may be (M18.266, cp43 F1). */
export const CLOCK_SLACK_MS = 5 * 60 * 1000;

/**
 * The problem when a staged change moves the loop's state without moving its clock honestly (M18.266, cp42 F3, cp43 F1):
 * state.json's currentTask or blockedReason, or the State of a backlog row HEAD already has, differs from HEAD, and the
 * staged `updated` is not later than HEAD's clock; and a staged `updated` that differs from HEAD's is refused whenever it is more
 * than CLOCK_SLACK_MS ahead of `now`. HEAD's clock is
 * its `updated`, or its commit time when that `updated` ran ahead of it, so an honest time after a future-dated HEAD
 * passes. A HEAD without state.json has no clock to compare.
 *
 * @param {{headState: string, stagedState: string, headBacklog: string, stagedBacklog: string, headCommitTime?: number, now?: number}} trees
 *   the four files' texts, HEAD's commit time and the time of this change (epoch ms)
 */
export function stateClockProblems({ headState, stagedState, headBacklog, stagedBacklog, headCommitTime = Number.NaN, now = Date.now() }) {
  if (!headState) return [];
  const [head, staged] = parseStates(headState, stagedState);
  if (head === undefined) return ['state.json is not readable JSON in HEAD or the staged tree'];
  const at = Date.parse(staged.updated);
  // a clock this change sets is never ahead of it, whatever else it moves; an unchanged one is HEAD's to answer for
  if (staged.updated !== head.updated && at > now + CLOCK_SLACK_MS)
    return [`state.json's updated (${staged.updated}) is ahead of this change's time; set it to the time of this change`];
  const moved = movedState(head, staged, headBacklog, stagedBacklog);
  if (moved.length === 0) return [];
  const what = `this change moves ${moved.join(', ')}`;
  if (Number.isNaN(at)) return [`state.json's updated (${staged.updated}) is not a date, and ${what}`];
  const floor = Math.min(...[Date.parse(head.updated), headCommitTime].filter((t) => !Number.isNaN(t)));
  if (!Number.isFinite(floor) || at > floor) return [];
  return [`state.json's updated (${staged.updated}) is not later than HEAD's (${head.updated}), but ${what}; set it to the time of this change`];
}

/** HEAD's and the staged state.json, or `[undefined]` when either is not JSON. */
function parseStates(headState, stagedState) {
  try {
    return [JSON.parse(headState), JSON.parse(stagedState)];
  } catch {
    return [undefined];
  }
}

/** What the staged change moves: currentTask, blockedReason, and each row of HEAD's whose State differs. */
function movedState(head, staged, headBacklog, stagedBacklog) {
  const same = (key) => JSON.stringify(head[key] ?? null) === JSON.stringify(staged[key] ?? null);
  const moved = ['currentTask', 'blockedReason'].filter((key) => !same(key));
  const before = rowStates(headBacklog);
  for (const [id, state] of rowStates(stagedBacklog)) if (before.has(id) && before.get(id) !== state) moved.push(`${id}'s State`);
  return moved;
}

/** The Commit cell problem of one backlog line, if it is a done row (see commitCellProblems). */
function rowCellProblem(line, { committed, head, history }) {
  const cells = line.split('|').map((c) => c.trim());
  const id = /^M\d+\.\d+$/.exec(cells[1] ?? '')?.[0];
  if (!id || !/^done\b/.test(cells[6] ?? '')) return undefined;
  if (cells[7]) return cellProblem(id, cells[7], history);
  const sha = committed.get(id);
  return sha && sha !== head ? `${id}: done since ${sha.slice(0, 7)} but its Commit cell is empty` : undefined;
}

/** The task the staged tree is committing, by its state.json currentTask; '' when unreadable. */
function stagedTask() {
  try {
    return String(JSON.parse(show('index', STATE)).currentTask ?? '');
  } catch {
    return '';
  }
}

/**
 * The rows whose review lines a change adds, leaving out lines any commit may carry: `rebind` and posthoc lines (both bind a commit
 * already landed, M18.127) and the milestone's checkpoint records, the row titled "Final independent milestone review" in the
 * backlog of the tree judged (M18.43 in M18). `range` is git diff's arguments; `tree` the backlog's tree.
 */
function addedLineTasks(range, tree) {
  const checkpoints = new Set([...show(tree, BACKLOG).matchAll(/^\| (M\d+\.\d+) \| Final independent milestone review/gm)].map((m) => m[1]));
  return addedLines(range)
    .filter((l) => l.verdict !== 'rebind' && !isPosthoc(l.reviewer) && !checkpoints.has(l.task))
    .map((l) => l.task);
}

/** The digest lines a change adds, parsed; `range` is git diff's arguments. */
function addedLines(range) {
  const diff = git(['diff', '--no-color', '-U0', ...range, '--', DIGEST]).stdout;
  return parseDigest(
    diff
      .split(/\r?\n/)
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1))
      .join('\n'),
  );
}

/**
 * The row the staged change is committed as: the task of the staged pass line bound to the staged content, which `record` wrote
 * for this change; state.json's currentTask only when there is none, since several streams share state.json (M18.231 r2 F1).
 */
function stagedOwner() {
  const ids = new Set(contentIds().filter(Boolean));
  return addedLines(['--cached', 'HEAD']).findLast((l) => l.verdict === 'pass' && ids.has(l.content))?.task ?? stagedTask();
}

/** Every task commit on HEAD from `since`'s first one on (OWN_LINES_SINCE by default), oldest first, whatever milestone is current (M18.231 r1 F3). */
function ownLineCommits(since = OWN_LINES_SINCE) {
  const rows = lines(git(['log', '--reverse', '--format=%H%x09%s', 'HEAD'])).flatMap((l) => {
    const [sha, subject = ''] = l.split('\t');
    const task = /^(M\d+\.\d+): /.exec(subject)?.[1];
    return task ? [{ sha, task }] : [];
  });
  const from = rows.findIndex((c) => c.task === since);
  return from < 0 ? [] : rows.slice(from);
}

/**
 * A commit adds digest lines for its own task only (M18.231, cp34 F2): a replay that carries another row's review lines onto main
 * would close that row's rounds before its own commit lands. Task commits from OWN_LINES_SINCE's first one on, by subject, and the
 * staged change, as its stagedOwner.
 */
function foreignLineProblems(tree) {
  const judged = ownLineCommits().map(({ sha, task }) => ({ who: `${sha.slice(0, 7)} ${task}`, task, range: [`${sha}^`, sha], at: sha }));
  const staged = tree === 'index' && judged.length > 0 ? stagedOwner() : '';
  if (tree === 'index' && judged.length > 0)
    judged.push({ who: `staged ${staged || '(no currentTask)'}`, task: staged, range: ['--cached', 'HEAD'], at: 'index' });
  return judged.flatMap(({ who, task, range, at }) =>
    [...new Set(addedLineTasks(range, at).filter((t) => t !== task))].map((t) => `${who}: adds review digest lines of ${t}, another row's (M18.231)`),
  );
}

/**
 * A task commit's body names no review round its own digest lines do not hold (M18.259, cp40 F1): a body that says "r1
 * changes-requested, r2 pass" over one pass line has a round the ledger lost, and the cap counted from the wrong number. Task
 * commits from ROUNDS_SINCE's first one on that add a digest line of their task; sentences naming another task or a checkpoint speak
 * of other reviews and are not read.
 */
function namedRoundProblems(tree) {
  const exempt = exemptions(tree, ROUNDS_EXEMPT);
  return ownLineCommits(ROUNDS_SINCE).flatMap(({ sha, task }) => {
    if (exempt.has(`${sha.slice(0, 7)} ${task}`)) return [];
    return messageRoundProblems(git(['log', '-1', '--format=%B', sha]).stdout, task, `${sha}^`, sha).map((m) => `${sha.slice(0, 7)} ${m}`);
  });
}

/** The remote-tracking branch land.mjs lands on, whose merge-base review.mjs record numbers rounds from. */
const LANDED = 'refs/remotes/origin/main';

/**
 * The landed base `target` was reviewed over, as review.mjs record reads it (M18.268 r2 F2, F3): a landed commit's parent, else the
 * merge-base with LANDED (the commit being made: of HEAD, so an amend keeps the amended commit's rounds), else the parent.
 */
function reviewBase(target) {
  const tip = target ? `${target}^` : 'HEAD';
  if (target && git(['merge-base', '--is-ancestor', target, LANDED]).status === 0) return tip;
  const base = git(['merge-base', tip, LANDED]);
  return base.status === 0 ? base.stdout.trim() : tip;
}

/**
 * The task's digest lines that count for the commit `target` (the index when absent): those record counted, openLines over the digest
 * on its review base, where a task's landed lines close its rounds once its own commit is there (M18.231). So a landed commit's
 * rounds never stand in for a later commit's, a replay keeps rounds another task's commit carried in, and an amend keeps its own.
 */
function countedLines(task, target) {
  const digest = (rev) => {
    const r = git(['show', `${rev}:${DIGEST}`]);
    return parseDigest(r.status === 0 ? r.stdout : '');
  };
  const base = reviewBase(target);
  const anyTask = git(['log', '-1', '-E', '--grep=^M[0-9]+\\.[0-9]+: ', '--format=%s', base]).stdout.trim() !== '';
  const own = git(['log', '--format=%s', '-F', `--grep=${task}: `, base])
    .stdout.split(/\r?\n/)
    .some((l) => l.startsWith(`${task}: `));
  // as landedTasks: a base with no task commit at all (a fixture) closes the committed lines as before
  const landed = anyTask ? new Set(own ? [task] : []) : undefined;
  return openLines(digest(target ?? ''), task, { committed: digest(base), landed });
}

/**
 * What a message names for `task` that the task's digest lines do not hold, for the commit `target` (the index when absent) over
 * `parent`, when it adds lines of its own. Each named round is looked for among the lines record counted for it (M18.268, cp42 F6).
 */
function messageRoundProblems(body, task, parent, target) {
  const own = addedLines(target ? [parent, target] : ['--cached', parent]).filter((l) => l.task === task && l.verdict !== 'rebind');
  // a commit with no line of its own is bookkeeping the recorder refuses ("no reviewable content"): it has no rounds to hold
  if (own.length === 0) return [];
  return missingRounds(namedRounds(body, task), countedLines(task, target)).map((m) => `${task}: its message names review ${m} (M18.259, M18.268)`);
}

/**
 * The commit being made, judged in the commit-msg hook before it can land (M18.259 r4 F1): its message against the digest lines the
 * staged change adds for the subject's task, once ROUNDS_SINCE has a commit on HEAD or is that task.
 */
export function checkMessage(message) {
  const task = /^(M\d+\.\d+): /.exec(message)?.[1];
  if (!task || git(['rev-parse', '--verify', 'HEAD']).status !== 0) return { ok: true, detail: 'digest message: SKIP — no task subject' };
  if (task !== ROUNDS_SINCE && ownLineCommits(ROUNDS_SINCE).length === 0) return { ok: true, detail: `digest message: SKIP — before ${ROUNDS_SINCE}` };
  const problems = messageRoundProblems(message, task, 'HEAD');
  if (problems.length)
    return {
      ok: false,
      detail: `digest message: ${problems.join('; ')}: record the missing rounds (posthoc lines for lost ones) or correct the message`,
    };
  return { ok: true, detail: `digest message: ${task}'s message names no round its digest lines lack` };
}

/**
 * progress.md holds an entry (`## <date> <task>:` or `## <task> — …`) only for a task with a commit on HEAD, or the staged task, or one headed
 * saying `not landed` (M18.231, cp34 F2): a replay must not leave the ledger claiming work main does not have.
 */
function progressProblems(tree) {
  const landed = new Set(lines(git(['log', '--format=%s', 'HEAD'])).flatMap((s) => /^(M\d+\.\d+): /.exec(s)?.[1] ?? []));
  if (tree === 'index') landed.add(stagedOwner());
  return show(tree, PROGRESS)
    .split(/\r?\n/)
    .flatMap((h) => {
      const m = /^## (?:\d{4}-\d{2}-\d{2} )?(M\d+\.\d+)\b/.exec(h);
      return m && !landed.has(m[1]) && !/\bnot landed\b/.test(h) ? [`progress.md has an entry for ${m[1]}, which has no commit: ${h.slice(0, 90)}`] : [];
    });
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
    ...headerCountProblems(show(tree, BACKLOG)),
    ...foreignLineProblems(tree),
    ...progressProblems(tree),
    ...namedRoundProblems(tree),
    ...(tree === 'index'
      ? stateClockProblems({
          headCommitTime: Date.parse(git(['log', '-1', '--format=%cI', 'HEAD']).stdout.trim()),
          headState: show('HEAD', STATE),
          stagedState: show('index', STATE),
          headBacklog: show('HEAD', BACKLOG),
          stagedBacklog: show('index', BACKLOG),
        })
      : []),
  ];
  if (problems.length) return { ok: false, detail: `digest: ${problems.length} problem(s)\n  ${problems.join('\n  ')}` };
  return { ok: true, detail: `digest: ${commits.length} ${milestone} task commits have tracked review evidence and Commit cells` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const at = process.argv.indexOf('--message');
  const verdict =
    at > 0
      ? checkMessage(readFileSync(process.argv[at + 1], 'utf8'))
      : checkDigest({ tree: process.argv.includes('--head') ? 'HEAD' : 'index', fullHistory: process.argv.includes('--full-history') });
  (verdict.ok ? console.log : console.error)(verdict.detail);
  process.exitCode = verdict.ok ? 0 : 1;
}
