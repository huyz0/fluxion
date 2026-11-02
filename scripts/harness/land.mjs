#!/usr/bin/env node
// Land reviewed local task commits on a moving remote branch (M18.106, ADR-0195):
//   land.mjs [--remote origin] [--branch main] [--push] [--attempts 3] [--ci-runs-file f (tests)]
// Each attempt fetches, re-applies the local commits onto the remote branch one by one,
// regenerates the API reports and traceability, and commits each through the real hooks, so
// commit-msg, checkpoint, the precommit ladder and the content-bound review check run on the tree
// that will land. Missing Commit cells of done rows are filled and cells naming a rewritten commit
// follow it (bookkeeping), also in the commits still to apply, so filling one row's cell never
// conflicts with the next commit's edit of its neighbour (M18.153); a .harness/budget.json `commit` naming
// a rewritten commit follows it the same way (M18.155). A conflict or any refused gate
// stops the run with the local branch back where it started; nothing is pushed. While a `blocks-landing` row is open, only that row's commits
// and commits confined to harness paths land, and closing it needs CI evidence (M18.123, M18.135). With --push, the result is pushed as a fast-forward, retried when the branch moved.
// Main's ci is read once per attempt with last-ci (M18.223, cp32 F2): while it is red or waiting on a declared fix, a commit
// that changes a non-harness path lands only with a `Fixes-ci: <id>` trailer naming a red run of the branch (ci-run-red.mjs);
// while it is unknown, a `feat` commit waits. Pushing still needs a human's request (skill ship).
import { existsSync, realpathSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ciEvidenceHolds, ciFixProblem, harnessPath, landingBlock } from '../gates/landing-block.mjs';
import { exists, git, node, repoPath, run } from '../gates/lib.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const BACKLOG = 'docs/backlog/current.md';
const CI_EVIDENCE = '.harness/reviews/ci-evidence.json';
const BUDGET = '.harness/budget.json';
const lines = (r) => r.stdout.split(/\r?\n/).filter(Boolean);
const fail = (message) => ({ ok: false, message });

function must(args, what) {
  const r = git(args);
  if (r.status !== 0) throw new Error(`${what}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** Regenerate the reports a rebase can stale; they are outside the content identity. */
/**
 * The regeneration commands, in order. check-api reads built declarations, and its TypeDoc run reads the
 * .tsbuild declarations of project references, which the hard reset to the remote leaves at the remote's
 * tree: `tsc -b` (typecheck) rebuilds them first, or a picked commit's new export is missing (M18.163).
 */
export const regenerateSteps = () => [
  [exists('turbo.json'), 'pnpm', ['run', 'typecheck']],
  [exists('turbo.json'), 'pnpm', ['run', 'build']],
  [exists('turbo.json'), process.execPath, ['scripts/gates/check-api.mjs', '--update']],
  [exists('docs/requirements/40-traceability.md'), process.execPath, ['scripts/gates/check-trace.mjs', '--write']],
];

function regenerate() {
  for (const [needed, cmd, args] of regenerateSteps()) {
    if (!needed) continue;
    const r = run(cmd, args);
    if (r.status !== 0) return `${args.join(' ')} failed:\n${r.stdout}${r.stderr}`;
  }
  return null;
}

/**
 * Fill the Commit cell of done rows whose task commit exists in history, and point cells that name
 * a commit this landing rewrote (`rewritten`: full old sha → full new sha) at the new sha, keeping
 * the cell's abbreviation length (bookkeeping only).
 */
const renamed = (cell, rewritten) => {
  if (!/^[0-9a-f]{7,40}$/.test(cell)) return null;
  for (const [old, next] of rewritten) if (old.startsWith(cell)) return next.slice(0, cell.length);
  return null;
};

export function fillCommitCells(text, commitOf, rewritten = new Map()) {
  return text
    .split('\n')
    .map((line) => {
      const cells = line.split('|');
      const id = /^\s*(M\d+\.\d+)\s*$/.exec(cells[1] ?? '')?.[1];
      if (!id || cells.length < 9 || !/^\s*done\b/.test(cells[6])) return line;
      const cell = cells[7].trim();
      const next = cell ? renamed(cell, rewritten) : commitOf.get(id);
      if (!next) return line;
      cells[7] = ` ${next} `;
      return cells.join('|');
    })
    .join('\n');
}

/** A budget record whose `commit` names a commit this landing rewrote, pointed at the new sha (M18.155). */
export function renameBudgetCommit(text, rewritten) {
  return text.replace(/("commit":\s*")([0-9a-f]{7,40})(")/, (whole, open, sha, close) => {
    for (const [old, next] of rewritten) if (old.startsWith(sha)) return `${open}${next.slice(0, sha.length)}${close}`;
    return whole;
  });
}

/** Rewrite the staged `path` with `edit` (bookkeeping), and refresh its working copy. */
function restage(path, edit) {
  const shown = git(['show', `:${path}`]);
  if (shown.status !== 0) return;
  const next = edit(shown.stdout);
  if (next === shown.stdout) return;
  const write = run('git', ['hash-object', '-w', '--stdin'], { input: next });
  const mode = lines(git(['ls-files', '-s', '--', path]))[0]?.split(' ')[0] ?? '100644';
  must(['update-index', '--cacheinfo', `${mode},${write.stdout.trim()},${path}`], `stage the rewritten ${path}`);
  must(['checkout', '--', path], `refresh the working ${path}`);
}

function fillCells(rewritten) {
  if (!exists(BACKLOG)) return;
  const commitOf = new Map(
    lines(git(['log', '--first-parent', '--reverse', '--format=%h %s', 'HEAD']))
      .map((l) => /^(\w+) (M\d+\.\d+):/.exec(l))
      .filter(Boolean)
      .map((m) => [m[2], m[1].slice(0, 7)]),
  );
  restage(BACKLOG, (text) => fillCommitCells(text, commitOf, rewritten));
}

/** The bookkeeping that names commits, each with how it follows the commits this landing rewrote. */
const RENAMES = {
  [BACKLOG]: (text, rewritten) => fillCommitCells(text, new Map(), rewritten),
  [BUDGET]: renameBudgetCommit,
};

/** `rev`'s tree with each bookkeeping file renamed for `rewritten`, built in a scratch index. */
function treeWith(rev, rewritten) {
  const tree = must(['rev-parse', `${rev}^{tree}`], 'read a tree');
  const blobs = [];
  for (const [path, rename] of Object.entries(RENAMES)) {
    const shown = git(['show', `${rev}:${path}`]);
    if (shown.status !== 0) continue;
    const next = rename(shown.stdout, rewritten);
    if (next === shown.stdout) continue;
    const mode = lines(git(['ls-tree', rev, '--', path]))[0]?.split(' ')[0] ?? '100644';
    blobs.push([path, mode, run('git', ['hash-object', '-w', '--stdin'], { input: next }).stdout.trim()]);
  }
  if (!blobs.length) return tree;
  // the real index holds the landing in progress
  const env = { ...process.env, GIT_INDEX_FILE: must(['rev-parse', '--path-format=absolute', '--git-path', 'land-remap.index'], 'locate a scratch index') };
  const step = (args, what) => {
    const r = git(args, { env });
    if (r.status !== 0) throw new Error(`${what}: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout.trim();
  };
  step(['read-tree', tree], 'read a tree into the scratch index');
  for (const [path, mode, blob] of blobs) step(['update-index', '--cacheinfo', `${mode},${blob},${path}`], `stage a remapped ${path}`);
  return step(['write-tree'], 'write a remapped tree');
}

/**
 * `sha` re-made with the Commit cells and budget record naming commits this landing rewrote already renamed on both
 * sides. Picked as is, a cell fillCells renamed on the remote side sits in the context of the next
 * commit's edit of a neighbouring row, and git reports a conflict no human made (M18.153).
 */
function remapped(sha, rewritten) {
  if (!rewritten.size || !lines(git(['diff', '--name-only', `${sha}^`, sha, '--', ...Object.keys(RENAMES)])).length) return sha;
  const parent = must(['commit-tree', treeWith(`${sha}^`, rewritten), '-m', 'land: remapped parent'], 'write a remapped parent');
  return must(['commit-tree', treeWith(sha, rewritten), '-p', parent, '-m', 'land: remapped'], 'write a remapped commit');
}

/** Main's ci by last-ci (M18.223): 0 green, 1 red, 2 waiting on a declared fix, 3 unknown; any other answer is unknown. */
function ciVerdict(branch) {
  const runsFile = opt('ci-runs-file');
  const r = node('scripts/harness/last-ci.mjs', ['--branch', branch, ...(runsFile ? ['--runs-file', runsFile, '--offline'] : [])]);
  return [0, 1, 2, 3].includes(r.status) ? r.status : 3;
}

/**
 * Why a commit may not land while main's ci gives `verdict`, or null (M18.223, cp32 F2): a commit confined to harness paths
 * always may; on red (1) or a pending declared fix (2) any other commit needs a `Fixes-ci: <id>` trailer whose run `isRed`
 * confirms; on unknown (3) a `feat` commit waits.
 */
export function ciRefusal(verdict, { paths, subject, message }, isRed) {
  if (verdict === 0 || paths.every(harnessPath)) return null;
  if (verdict === 3) return /^M\d+\.\d+: feat\(/.test(subject) ? "main's ci is unknown (last-ci exit 3); a feature commit waits until it reads green" : null;
  const ids = [...message.matchAll(/^Fixes-ci: (\d+)\s*$/gm)].map((m) => m[1]);
  if (!ids.length)
    return `main's ci is red (last-ci exit ${verdict}); until it is green only harness-path commits and commits carrying Fixes-ci: <red run> land`;
  const notRed = ids.map((id) => isRed(id)).find(Boolean);
  return notRed ? `its Fixes-ci names no red run of the branch: ${notRed}` : null;
}

/**
 * Re-apply each local commit of `start` missing from `upstream` onto `upstream`, oldest first,
 * committing each through the hooks. Commits already on upstream (same patch) are skipped.
 */
function recommit(upstream, start, verdict) {
  const commits = lines(git(['rev-list', '--reverse', '--right-only', '--cherry-pick', '--no-merges', `${upstream}...${start}`]));
  must(['reset', '-q', '--hard', upstream], 'move to the remote branch');
  const rewritten = new Map();
  for (const sha of commits) {
    const subject = must(['log', '-1', '--format=%s', sha], 'read the subject');
    const paths = lines(git(['diff', '--name-only', '--no-renames', `${sha}^`, sha]));
    const blocked = landingBlock({
      backlog: git(['show', `HEAD:${BACKLOG}`]).stdout,
      subject,
      message: must(['log', '-1', '--format=%B', sha], 'read the message'),
      // the commit's own change decides whether it closes a row; it may predate the mark
      before: git(['show', `${sha}^:${BACKLOG}`]).stdout,
      proposed: git(['show', `${sha}:${BACKLOG}`]).stdout,
      paths,
      evidence: git(['show', `${sha}:${CI_EVIDENCE}`]).stdout,
      // the re-applied commit's parent is the remote tip it lands on
      evidenceOk: (record) => ciEvidenceHolds(record, must(['rev-parse', 'HEAD'], 'read the tip'), { runsFile: opt('ci-runs-file') }),
      // a planned ci fix: a real red run, once (M18.192)
      ciFixProblem: (task, id) => ciFixProblem(task, id, must(['rev-parse', 'HEAD'], 'read the tip'), { runsFile: opt('ci-runs-file') }),
    });
    if (blocked) return fail(`${sha.slice(0, 7)} (${subject}) may not land: ${blocked}`);
    const message = must(['log', '-1', '--format=%B', sha], 'read the message');
    const red = ciRefusal(verdict, { paths, subject, message }, (id) => {
      const runsFile = opt('ci-runs-file');
      const r = node('scripts/gates/ci-run-red.mjs', [id, '--since', upstream, ...(runsFile ? ['--runs-file', runsFile] : [])]);
      return r.status === 0 ? null : r.stderr.trim() || `run ${id} is not a red ci run`;
    });
    if (red) return fail(`${sha.slice(0, 7)} (${subject}) may not land: ${red}`);
    const picked = git(['cherry-pick', '-n', remapped(sha, rewritten)]);
    if (picked.status !== 0)
      return fail(
        `${sha.slice(0, 7)} (${subject}) conflicts with the remote branch; rebase by hand (keep both sides of bookkeeping, regenerate reports), then land again:\n${picked.stdout}${picked.stderr}`,
      );
    const stale = regenerate();
    if (stale) return fail(stale);
    must(['add', '-u'], 'stage regenerated reports'); // tracked files only: never sweep in untracked work
    fillCells(rewritten);
    const r = git(['commit', '-q', '-C', sha]);
    if (r.status !== 0) return fail(`gates refused ${sha.slice(0, 7)} (${subject}) on the remote branch:\n${r.stdout}${r.stderr}`);
    rewritten.set(sha, must(['rev-parse', 'HEAD'], 'read the new commit'));
  }
  return { ok: true, count: commits.length };
}

/** The commits are gated by the repo's hooks, so they must be the ones git runs (M18.106 r1 F1). */
function hooksProblem() {
  const configured = git(['config', 'core.hooksPath']).stdout.trim();
  const active = configured && existsSync(repoPath(configured)) ? realpathSync(repoPath(configured)) : null;
  if (active !== realpathSync(repoPath('.githooks')))
    return `git does not run the repo hooks (core.hooksPath is '${configured || 'unset'}'); run pnpm run setup`;
  // POSIX git skips a hook that is not executable
  const off = ['pre-commit', 'commit-msg'].filter(
    (h) => !existsSync(repoPath('.githooks', h)) || (process.platform !== 'win32' && !(statSync(repoPath('.githooks', h)).mode & 0o111)),
  );
  return off.length ? `hooks missing or not executable: ${off.join(', ')}` : null;
}

/**
 * Untracked or ignored files at paths the fetched branch tracks: a hard reset would destroy them
 * (r1 F4). Judged against the checked-out HEAD, which a retry has already moved (r2 F1).
 */
function untrackedInTheWay(upstream) {
  return lines(git(['diff', '--name-only', '--no-renames', '--diff-filter=A', 'HEAD', upstream])).filter((p) => existsSync(repoPath(p)));
}

/** One attempt: gate the commits on the fetched branch, then push. `retry` when the branch moved. */
function attempt({ remote, branch, push, start }) {
  must(['fetch', '-q', remote, branch], `fetch ${remote}/${branch}`);
  const upstream = must(['rev-parse', 'FETCH_HEAD'], 'read the fetched branch');
  if (!lines(git(['rev-list', `${upstream}..${start}`])).length) return { ok: true, message: `nothing to land on ${remote}/${branch}` };
  const clobbered = untrackedInTheWay(upstream);
  if (clobbered.length) return fail(`untracked files would be overwritten by ${remote}/${branch}; move them first:\n  ${clobbered.join('\n  ')}`);
  const gated = recommit(upstream, start, ciVerdict(branch));
  if (!gated.ok) return gated;
  const digest = node('scripts/gates/check-digest.mjs', ['--head']);
  if (digest.status !== 0) return fail(`landed history lacks review evidence:\n${digest.stdout}${digest.stderr}`);
  if (!push) return { ok: true, message: `re-gated ${gated.count} commit(s) on ${remote}/${branch}; not pushed (--push)` };
  const pushed = git(['push', '-q', remote, `HEAD:${branch}`]);
  if (pushed.status === 0)
    return { ok: true, message: `landed ${gated.count} commit(s) on ${remote}/${branch} at ${must(['rev-parse', '--short', 'HEAD'], 'read HEAD')}` };
  // only a moved branch is worth another attempt; "[remote rejected]" (a hook, a protected branch) is final
  return /non-fast-forward|fetch first|^\s*! \[rejected\]/m.test(pushed.stderr) ? { retry: true } : fail(`push failed:\n${pushed.stderr}`);
}

/** Land the local commits; on any failure the branch is back at its starting commit. */
export function land({ remote = 'origin', branch = 'main', push = false, attempts = 3 } = {}) {
  if (lines(git(['status', '--porcelain', '--untracked-files=no'])).length) return fail('working tree has uncommitted changes; land commits only');
  const hooks = hooksProblem();
  if (hooks) return fail(hooks);
  const start = must(['rev-parse', 'HEAD'], 'read HEAD');
  let result = fail(`${remote}/${branch} kept moving; ${attempts} attempts used`);
  try {
    for (let n = 0; n < attempts; n++) {
      const r = attempt({ remote, branch, push, start });
      if (!r.retry) {
        result = r;
        break;
      }
    }
  } catch (e) {
    result = fail(e.message);
  }
  if (!result.ok) {
    git(['cherry-pick', '--abort']);
    git(['reset', '-q', '--hard', start]);
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let result;
  try {
    result = land({ remote: opt('remote', 'origin'), branch: opt('branch', 'main'), push: argv.includes('--push'), attempts: Number(opt('attempts', '3')) });
  } catch (e) {
    result = fail(e.message);
  }
  (result.ok ? console.log : console.error)(`land: ${result.message}`);
  process.exitCode = result.ok ? 0 : 1;
}
