// Intermittent ci failures on one product tree (M18.196, cp25 F2): a fix for a failure that comes and
// goes is not verified by one green run. check-ci-evidence --record and last-ci read every ci run whose
// head has the same product tree as the green run they rely on (no commit changing a product path in
// between), and a job that failed or timed out in one of them counts until it has been green in
// REQUIRED_GREENS later completed runs on that tree. A product path is any path outside HARNESS_PATHS,
// docs/ and .changeset/: those change no code a ci job runs as the product. The runs are read page by
// page back to the tree's start, never from a fixed window that can drop the failed run (M18.199, cp26 F1).
import { harnessPath } from './landing-block.mjs';
import { git } from './lib.mjs';

/** Later completed runs on the tree in which a failed job must have passed before it stops counting. */
export const REQUIRED_GREENS = 2;
const FAILED = new Set(['failure', 'timed_out']);
/** ci's aggregate job fails whenever another job fails or is cancelled; the job that failed is the evidence. */
const AGGREGATE = new Set(['ci-ok']);

export const productPath = (path) => !harnessPath(path) && !path.startsWith('docs/') && !path.startsWith('.changeset/');

/**
 * The newest commit at or before `sha` that changes a product path, or null when `sha` is not a
 * known commit or no commit does (`gitRun` is injected for tests).
 */
export function productBase(sha, gitRun = git) {
  // \x01 marks each commit: it cannot occur in a path
  const log = gitRun(['log', '--format=%x01%H', '--name-only', '--no-renames', String(sha)]);
  if (log.status !== 0) return null;
  for (const entry of log.stdout.split('\x01').filter(Boolean)) {
    const [commit, ...paths] = entry.split(/\r?\n/).filter(Boolean);
    if (paths.some(productPath)) return commit;
  }
  return null;
}

/** Whether `head` has the product tree `base` starts: `base` is `head` or an ancestor of it and no later product commit is. */
export function onTree(base, head, gitRun = git) {
  if (!base || !head) return false;
  if (gitRun(['merge-base', '--is-ancestor', base, String(head)]).status !== 0) return false;
  return productBase(head, gitRun) === base;
}

/**
 * The failed jobs of `runs` (all on one tree; `{ databaseId, headSha, createdAt, status, jobs }`) not yet
 * green in REQUIRED_GREENS later completed runs, oldest first: `{ run, sha, job, conclusion, greens }`.
 * A cancelled job is no failure; a cancelled run's jobs that failed before it was cancelled are.
 */
export function intermittent(runs, greens = REQUIRED_GREENS) {
  const byTime = [...runs].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const out = [];
  for (const [i, run] of byTime.entries()) {
    for (const job of run.jobs ?? []) {
      if (!FAILED.has(job.conclusion) || AGGREGATE.has(job.name)) continue;
      const passed = byTime
        .slice(i + 1)
        .filter((r) => r.status === 'completed' && (r.jobs ?? []).some((j) => j.name === job.name && j.conclusion === 'success')).length;
      if (passed < greens) out.push({ run: run.databaseId, sha: run.headSha, job: job.name, conclusion: job.conclusion, greens: passed });
    }
  }
  return out;
}

/** One line per intermittent job, naming its failed run and how many later greens it has. */
export const describe = (found, greens = REQUIRED_GREENS) =>
  found.map(
    (f) =>
      `job ${f.job} ${f.conclusion} in ci run ${f.run} at ${String(f.sha).slice(0, 7)} on the same product tree, green in ${f.greens} later run(s) of ${greens} needed`,
  );

/** Pages read before a tree's start is given up as out of reach (M18.199). */
export const TREE_MAX_PAGES = 20;

/**
 * The runs on one tree, read newest first page by page (`page(n)`, from 1) until a run at or before the
 * tree's start (`start(run)`) has been read (M18.199, cp26 F1); `on(run)` says a run is on the tree.
 * Throws when a page cannot be read, or the pages run out (an empty page, or `maxPages` read) before the
 * start, unless `complete`: the source then holds the whole history (a test's runs file). Unread runs are no green.
 */
export async function pagedTreeRuns({ page, on, start, complete = false, maxPages = TREE_MAX_PAGES }) {
  const out = [];
  for (let n = 1; n <= maxPages; n++) {
    const runs = await page(n);
    if (!Array.isArray(runs) || runs.length === 0) {
      if (complete) return out;
      throw new Error(`main's ci runs ran out at page ${n} before a run at or before the tree's start`);
    }
    if (collect(runs, on, start, out)) return out;
  }
  throw new Error(`no run at or before the tree's start in ${maxPages} pages of main's ci runs`);
}

/** Pushes the runs of one page that are `on` the tree to `out`; true once a run at the tree's `start` is read. */
function collect(runs, on, start, out) {
  for (const r of runs) {
    if (on(r)) out.push(r);
    if (start(r)) return true;
  }
  return false;
}

/**
 * The runs on `sha`'s product tree through `page` (see pagedTreeRuns): on the tree is onTree, before
 * its start is a proper ancestor of the product base. Throws when the tree cannot be read.
 */
export function shaTreeRuns(page, sha, { gitRun = git, complete = false, maxPages } = {}) {
  const base = productBase(sha, gitRun);
  if (!base)
    return Promise.reject(new Error(`the product tree of ${String(sha).slice(0, 7)} cannot be read (no such commit locally, or no product commit before it)`));
  return pagedTreeRuns({
    page,
    on: (r) => onTree(base, r.headSha, gitRun),
    // strictly before: every run at the base itself is on the tree and read
    start: (r) => r.headSha !== base && gitRun(['merge-base', '--is-ancestor', String(r.headSha), base]).status === 0,
    complete,
    maxPages,
  });
}
