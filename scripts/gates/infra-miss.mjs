// A ci job no hosted runner acquired (M20.37, cp3 F1): GitHub concludes such a job `cancelled` with zero steps (the
// "was not acquired by Runner" annotation; at 5ba5217 the macOS jobs, runner_name null) and the run fails through
// ci-ok. That is an infrastructure miss, not a product red: last-ci and check-ci-evidence say so and name the remedy.
// It is never green either: a job that never ran proves nothing, so evidence and the same-tree green counts ignore it.
import { readFileSync, writeFileSync } from 'node:fs';

/** Job conclusions that are a product failure (ci's aggregate job aside). */
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

/** What a reader does about an infrastructure miss. */
export const INFRA_REMEDY = "not a product red and never green: the next push's run is the remedy; a re-run of the same sha is never counted as evidence";

/** Consecutive completed runs that each miss one job before the starvation is the owner's decision. */
export const STARVED_RUNS = 3;

/** The number of steps job `job` ran: its `steps` array's length, or a count; undefined when unknown. */
const stepCount = (job) => (Array.isArray(job?.steps) ? job.steps.length : typeof job?.steps === 'number' ? job.steps : undefined);

/** Whether `job` concluded cancelled without running a step: no hosted runner acquired it. Unknown steps are no miss. */
export const neverAcquired = (job) => job?.conclusion === 'cancelled' && stepCount(job) === 0;

/**
 * The jobs of a run that no runner acquired, when that is all that went wrong: no job failed (ci-ok aside). [] when a job failed,
 * when none was missed, or when the jobs cannot be read.
 */
export function infraMiss(jobs) {
  if (!Array.isArray(jobs)) return [];
  if (jobs.some((j) => FAILED.has(j.conclusion) && j.name !== 'ci-ok')) return [];
  return jobs.filter(neverAcquired).map((j) => j.name);
}

/** The jobs missed in every one of `misses` (each a run's infraMiss, newest first) when there are at least STARVED_RUNS of them. */
export function starved(misses) {
  const newest = misses.slice(0, STARVED_RUNS);
  if (newest.length < STARVED_RUNS) return [];
  return newest.reduce((left, jobs) => left.filter((name) => jobs.includes(name)));
}

/** Set `.blockedReason` of the state file at `path` to `reason` unless one is set already; true when it was written. */
export function recordStarvation(path, reason) {
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof state.blockedReason === 'string' && state.blockedReason !== '') return false;
  writeFileSync(path, `${JSON.stringify({ ...state, blockedReason: reason }, null, 2)}\n`);
  return true;
}
