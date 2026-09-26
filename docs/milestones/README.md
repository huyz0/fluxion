# Milestones

- [roadmap.md](roadmap.md) — ordered milestones, current milestone, completion commands.
- `M<n>.md` — one plan per milestone. A plan is a **hypothesis**: `plan-milestone` re-derives
  the executable backlog from it when the milestone starts.

## Plan template

Every `M<n>.md` follows this shape (≤ ~20 tasks; split the milestone if it needs more):

```markdown
# M<n> — <Name>

| Increment | Depends on | Completion command |
|---|---|---|
| R<k> | M<a>, M<b> | `node scripts/gates/m<n>-complete.mjs` |

## Goal
One paragraph: the user-visible or developer-visible outcome.

## Requirements
FR/NFR IDs delivered (fully or partially — mark partial with "(part)").

## Decide before coding
ADRs to write first (or "none").

## Scope / Non-scope
Bullets.

## Tasks (plan)
| # | Task | Req | Acceptance (EARS, abbreviated) |
|---|---|---|---|
| 1 | Write completion gate m<n>-complete.mjs (red) | all | Gate runs, fails on every leg |
| … | … | … | … |

## Completion gate legs
What `m<n>-complete.mjs` checks (one line each, all observable).

## Risks
Risk → early signal → mitigation.

## Learned
(Filled by milestone review.)
```

Task 1 is always the completion gate, written red. The last task is always the milestone
review + demo/docs update.
