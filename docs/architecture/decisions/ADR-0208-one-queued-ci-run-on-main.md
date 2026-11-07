---
status: accepted
date: 2026-11-07
decision-makers: Huy (decision card, 2026-10-29; "ok to push", 2026-11-07); harness (M18.188, subject to independent review)
---

# ADR-0208 — ci keeps one queued run on main

## Context and Problem Statement

ci.yml gave every push to main a concurrency group of its own (`ci-<sha>`), so every push ran the
whole job set, even when a newer push was already queued behind it. A ci run asks for 31 jobs and
the account runs 20 at once (5 on macOS), so two or three runs in flight wait on each other for
runners. Of the 60 main ci runs from 2026-11-04 to 2026-11-07, 32 started while an earlier one was
still running and 18 while two or more were.

Main is linear: a run of a newer push tests the tree of every commit before it. A queued run that
has not started gives no verdict a newer run does not also give.

## Decision Drivers

- Never weaken a gate: every commit's tree is still tested by a run that includes it, and a run
  that has started is never cancelled, so its jobs' verdict is never lost.
- The newest push always runs, so `check-ci-evidence --record <tip>` can always record the tip.
- `last-ci` must not read a replaced run as red, or lose a `Fixes-ci:` declaration its commit made.

## Considered Options

1. **Keep a group per push.** Every push costs a full run, and runs queue behind each other.
2. **One group for main with `cancel-in-progress: true`.** Cancels a running run, so its verdict
   and the tip evidence of a slow run are lost. Breaks the never-cancel-a-running-main-run rule.
3. **One group for main pushes, `cancel-in-progress: false`.** GitHub then runs one run at a time
   and keeps one queued run, replacing it with each newer push. Chosen.

## Decision Outcome

ci.yml's push runs share the group `ci-push-main`; pull requests keep their ref's group (cancelling)
and merge-group runs keep a group per sha. gates.yml is unchanged: it keeps one run per push,
because `check-commits` checks each push's own commit range.

`last-ci` already skips a cancelled run none of whose jobs failed (M18.232), which is what a
replaced queued run is. It now also:

- reads each workflow's ten newest completed push runs instead of one (`COMPLETED_RUNS`), so replaced
  runs at the head of that list never hide the last run that ran;
- reads cold-setup from the newest completed run that was not such a replaced run;
- treats a `Fixes-ci:` trailer (and the M18.200 same-job product fix) of a replaced run's head as
  declared by the newer run that replaced it, bounding the wait from the replaced push's time, so
  replacing a run never lengthens LAST_CI_MAX_WAIT_MS.

### Consequences

- Good: at most two ci runs on main at a time (one running, one queued), so fewer runners are
  asked for when several commits land close together.
- Bad: a replaced commit has no ci run of its own; a red found by the newer run is read against
  the newer head. `check-ci-evidence --record` must name the tip (or a sha whose run was not
  replaced); a replaced sha has no green run to record.
- Main's ci verdict for a push comes after the running run ends, not alongside it.
