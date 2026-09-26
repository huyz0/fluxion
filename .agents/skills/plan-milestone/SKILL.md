---
name: plan-milestone
description: Turn the current milestone's plan into an executable backlog and write its completion gate first (red). Use when a milestone starts, when docs/backlog/current.md has no rows for the current milestone, or when the completion command does not exist yet.
---

# Plan a milestone

Inputs: `docs/milestones/roadmap.md` (current milestone, completion command),
`docs/milestones/M<N>.md` (the plan — a hypothesis), the requirement files it cites, the
architecture docs it names. Standard: `docs/standards/sdd.md`.

## Steps

1. **Archive the previous milestone**: move its rows from `docs/backlog/current.md` to
   `docs/backlog/archive/M<N-1>.md` (only if its completion gate passes and its milestone
   review is recorded).
2. **Decide before coding**: for each decision listed in the plan, check an ADR exists. Missing
   → write it with [`adr`](../adr/SKILL.md) as the first rows (or stop if it needs a human).
3. **Write the completion gate first**: `scripts/gates/m<N>-complete.mjs`, built on
   `scripts/gates/lib.mjs` (`leg(name, fn)`, `runLegs()`). One leg per exit criterion of the
   plan, each checking something observable: a test tag passing
   (`vitest run -t "FR-XXX-000"`), a Playwright project, a file/fixture existing and valid, a
   benchmark under a threshold from `thresholds.mjs`, a trace check for the milestone's
   requirement IDs, and the milestone-review verdict file. Run it and confirm it is **red**.
   Commit it as row `M<N>.1`.
4. **Re-derive rows** from the plan's task list (do not copy blindly — earlier milestones may
   have changed the right decomposition). Each row: ID `M<N>.<k>`, one-commit scope, requirement
   IDs, EARS acceptance, dependencies. Keep rows in dependency order.
5. **Record the planned count** in the backlog header (`Planned: <k> rows`) — growth beyond 1.5×
   must be explained in the milestone review.
6. Set `.harness/state.json` → `milestone`, `currentTask: null`, `blockedReason: null`.
7. Get the plan reviewed: dispatch a fresh reviewer on the backlog + gate (skill
   [`code-review`](../code-review/SKILL.md) with `--kind plan`) before coding row 2.

## Row format (`docs/backlog/current.md`)

```
| ID | Task | Req | Acceptance (EARS) | Deps | State | Commit |
| M5.3 | Orthogonal elbow router (no obstacles) | FR-CON-002 | WHEN a connector has route=orthogonal THE SYSTEM SHALL render only axis-aligned segments with ≤ 3 bends between non-overlapping shapes | M5.2 | todo | |
```
