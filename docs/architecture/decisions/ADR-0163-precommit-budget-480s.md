---
status: accepted
date: 2026-10-07
decision-makers: the human (answer to the budget question, 2026-10-07: "Raise budget to 480 s instead"), recorded by harness (M12.37; amends NFR-DX-002, weakens `PRECOMMIT_BUDGET_MS`; supersedes ADR-0158)
---

# ADR-0163 — The pre-commit budget is 480 s

Supersedes ADR-0158.

## Context and Problem Statement

ADR-0158 set `PRECOMMIT_BUDGET_MS` to 360 s, a margin of about 15 % over a worst-case staged run of 315 s on the 4-core environment
the loop runs in. The ladder has grown since, mostly with the M11 player suites and the M12 harness files. `check-budget.mjs --record`
times the worst-case staged commit (`worst-case.mjs`: every harness file, the whole Vitest run, the packaging checks). On the same 4-core
container that took about 410 s in four runs on 2026-10-07. A lockfile commit needs a fresh record, so M12.8, which adds `yaml` (the
tech stack's FluxScript parser), could not land. Ordinary commits stay far below the budget: 140–200 s with `ladder-scope.mjs`.

## Considered Options

1. **Record on a faster machine.** The human first chose this, then chose option 2.
2. **Raise the budget to 480 s**, a margin of about 17 % over the measured 410 s, as ADR-0158 did over its 315 s.
3. **Narrow the worst case.** It is by definition the commit that scoping cannot narrow (M8.20), so narrowing it would only move the
   real cost out of sight.

## Decision Outcome

Option 2. `PRECOMMIT_BUDGET_MS` is **480 000 ms** (8 min). This weakens a gate, so the commit carries `Threshold-change:` citing this
ADR. NFR-DX-002, `docs/standards/performance.md` and `docs/standards/ci-cd.md` say 480 s. The quick gate (120 s, ADR-0161) and the
cold-setup limit (600 s) do not move. The budget is still enforced: `check-budget.mjs` fails a record over it, and the staged ladder
fails any run over it.

## Consequences

- Good: lockfile commits land again (M12.8's `yaml`, later dependencies of M12 and M13).
- Bad: the worst-case commit may take up to eight minutes. Scoped commits stay at two to three minutes.
- Revisit: lower the value when the loop runs on a faster machine (a tightening needs no ADR), or when the harness files are split
  further.

## Confirmation

`tests/harness/budget.test.mjs` reads `PRECOMMIT_BUDGET_MS` from `thresholds.mjs`. `node scripts/gates/check-budget.mjs` passes with a
record at or under 480 s, recorded with M12.8's lockfile.
