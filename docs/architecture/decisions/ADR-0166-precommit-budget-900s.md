---
status: accepted
date: 2026-10-15
decision-makers: the human (answer to the budget question, 2026-10-15: "Set it to 900 s"), recorded by harness (M13.27; amends NFR-DX-002, weakens `PRECOMMIT_BUDGET_MS`; supersedes ADR-0165)
---

# ADR-0166 — The pre-commit budget is 900 s

Supersedes ADR-0165.

## Context and Problem Statement

ADR-0165 set `PRECOMMIT_BUDGET_MS` to 600 s, about 11 % over the 541 s measured on 2026-10-13. The first recording under it measured 597.8 s (it failed on a TypeDoc warning in the change being recorded), the second 616.5 s and failed the budget. The same unchanged worst case has now measured 446, 523.5, 534.0, 541.5, 597.8 and 616.5 s over three days, and the quick gate 113, 129, 140, 154 and 164 s. Disk, memory and caches are normal (29 GB free, 15 GB memory free, a 26 MB Vitest cache); nothing in the repository explains the drift, which points at a shared, noisy container. A budget set a few percent above one reading fails on the next, and M13.5 and M13.8 (lockfile commits) cannot land.

## Considered Options

1. **Raise the budget to 900 s**, about 45 % over the latest reading, so container noise stops blocking lockfile commits.
2. **Park the lockfile rows** until timings recover. No date, and M13 cannot finish meanwhile.
3. **Stop for a faster machine.** Moves the cost to the human.

## Decision Outcome

Option 1. `PRECOMMIT_BUDGET_MS` is **900 000 ms** (15 min). This weakens a gate, so the commit carries `Threshold-change:` citing this ADR. NFR-DX-002, `docs/standards/performance.md` and `docs/standards/ci-cd.md` say 900 s. The quick-gate budget (180 s, ADR-0164) and the cold-setup limit (600 s) do not move. The budget is still enforced: `check-budget.mjs` fails a record over it and the staged ladder fails any run over it.

## Consequences

- Good: lockfile commits land again and a noisy minute no longer fails a record.
- Bad: the worst-case commit may take up to fifteen minutes. Scoped commits stay at three to five minutes on today's container.
- Revisit: lower the value when the loop runs on a faster machine (a tightening needs no ADR). A budget that follows the machine's drift is a smell: a profiling row for the worst-case ladder belongs in a later milestone.

## Confirmation

`tests/harness/budget.test.mjs` reads both limits from `thresholds.mjs`; `node scripts/gates/check-budget.mjs` passes with a record under them.
