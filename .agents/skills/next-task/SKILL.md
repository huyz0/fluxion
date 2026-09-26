---
name: next-task
description: Choose the next task and confirm it is genuinely ready. Use at the start of a working session, after finishing a task, or when unsure what to do next. Prevents starting work that is blocked, unspecified, too large, or already done.
---

# Next task

## Choose

1. Open `docs/backlog/current.md`. Only the current milestone lives there. If it is empty or
   for another milestone, run [`plan-milestone`](../plan-milestone/SKILL.md).
2. Take the **top** row whose State is `todo` and whose dependencies are `done`. Order is
   dependency order — do not cherry-pick the interesting one.
3. A row is blocked if it depends on an unfinished row, an undecided question, or an ADR
   listed as "Decide before coding" that does not exist. Mark it `blocked` with a reason.
4. If the top three candidates are all blocked, stop: that is a planning problem
   (`drive` stop condition).

## Confirm before starting

- [ ] Cites at least one FR/NFR ID (or `HARNESS` for harness rows).
- [ ] Has EARS acceptance criteria checkable by a test/gate/number. If not, write them
      ([`spec`](../spec/SKILL.md)) in the row before coding.
- [ ] Fits one commit that leaves the tree green (rule of thumb: ≤ ~400 changed lines excl.
      fixtures/snapshots). If not, split into new rows now.
- [ ] Not already done: check `git log --grep "<ID>:"`.

## Then

Set the row to `doing`, write `currentTask` into `.harness/state.json`, and implement with
[`tdd`](../tdd/SKILL.md).
