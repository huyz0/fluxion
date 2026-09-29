---
name: drive
description: Drive the current milestone to completion autonomously, one backlog task per commit, without asking between tasks. Use when told to work a milestone, continue, keep going, auto-proceed, or when running under /goal. Defines the loop, the evidence to print each turn, and the conditions under which it must stop.
---

# Drive: the autonomous milestone loop

Usually launched through the tool's built-in goal command with the text in
[references/goal-template.md](references/goal-template.md). The goal is met only by the
milestone's completion command exiting 0 — never by your opinion.

## 1. Orient (every session start and every resume)

1. Read `.harness/state.json`, the last 3 entries of `.harness/progress.md`,
   `git log -10 --oneline`, and the **Current milestone** line of `docs/milestones/roadmap.md`.
2. Run `node scripts/gates/precommit.mjs --quick` (or `pnpm verify:fast` from M1). If red and
   the cause is not your in-progress task, fixing the tree is the first task.
3. Run `node scripts/harness/last-ci.mjs` (main's newest completed `ci` and `gates` runs). If it
   exits 1, main's CI is red: fixing it is the first task, before any row (M4 final F3). Exit 2
   means a newer run (the fix) is still pending: wait for it and run last-ci again; do not fix twice.
4. If `state.json.blockedReason` is set, report it and stop — a human must clear it.

## 2. Preconditions

- The completion command `node scripts/gates/m<N>-complete.mjs` **exists**. If not, run
  [`plan-milestone`](../plan-milestone/SKILL.md): it writes the gate first, red.
- `docs/backlog/current.md` holds rows for M<N>. If not, `plan-milestone`.
- Decisions listed under "Decide before coding" in `docs/milestones/M<N>.md` have ADRs.

## 3. The loop

```
until node scripts/gates/m<N>-complete.mjs exits 0:
  1  next-task          top unblocked row → state.json.currentTask, row state=doing
  2  spec check         EARS acceptance criteria present & checkable? else `spec`
  3  tdd                failing test (named with FR/NFR id) → watch fail → implement → pass
  4  ui-check           if the task changes anything visible/interactive
  5  bookkeeping        row state=done in backlog; ≤10-line entry in .harness/progress.md;
                        state.json updated — all staged WITH the code (one commit per task)
  6  verify             node scripts/gates/precommit.mjs --staged  (print summary)
  7  code-review        independent reviewer; record verdict (max 3 rounds)
  8  fix or argue       blocking/major fixed (then back to 6); minors → rows/argued
  9  commit             "<ID>: <type>(<scope>): <summary>" + Co-Authored-By trailer,
                        without restaging (verdict is bound to the staged hash)
 10  gate               run the completion command; print its summary lines
```

The commit for a row is found with `git log --grep "^<ID>:"`; the backlog's Commit column is
filled in by the next task's bookkeeping (or left blank — it is derivable).

One row per commit. If a row turns out to be two commits, split the row first.

## 4. Outer loop

Every ~8 commits and always before declaring done: run
[`milestone-review`](../milestone-review/SKILL.md) **with a fresh agent** (not you). Dispose
each finding: *reopen* (affects this milestone's requirements) → new row now; *hand off* →
row in next milestone + roadmap "Deferred" table; *argue* → `.harness/baselines/review-argued.txt`.
The milestone ends by disposition, not by an empty backlog.

## 5. Stop conditions — stop, record `blockedReason`, report

- A gate still fails after 3 genuine fix attempts on the same cause.
- A decision is needed: ambiguous requirement, conflicting standards, unplanned contract change.
- The spec is wrong and correcting it changes scope or a requirement (write it up via `spec`/`adr`).
- The top 3 unblocked rows are all blocked.
- The completion gate is green but the milestone is obviously not done (gate bug = finding).
- The next step is destructive or outward-facing (push, publish, delete data, external calls).
- Goal turn budget nearly spent: leave the tree green and the progress log current.

## 6. Evidence rule

Every turn that changes code ends with a printed block:

```
EVIDENCE task=<ID> precommit=<pass|fail> review=<pass|n/a> commit=<sha|none>
GATE m<N>: <k>/<n> legs green — next red leg: <name>
```

The goal evaluator reads only the transcript. Never print a result you did not observe.

## 7. Never in the loop

Skip review · weaken a threshold or delete a test · commit a red tree · widen scope silently ·
push/publish · work outside your worktree · leave `state.json` stale.

## 8. Report (at every stop and at completion)

What was done (IDs + commits), what was **not** done and why, anything that invalidates the
plan, and the exact next step. Style: [`brevity`](../brevity/SKILL.md).
