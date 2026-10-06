---
status: accepted
date: 2026-10-06
decision-makers: the human (answer to the quick-budget question, 2026-10-06: "Raise quick to 120 s"), recorded by harness (M11.70; amends NFR-DX-002 beside ADR-0158, weakens `QUICK_GATE_BUDGET_MS`)
---

# ADR-0161 — The quick-gate budget is 120 s

## Context and Problem Statement

ADR-0158 raised the pre-commit (staged) budget to 360 s so lockfile commits can land. `check-budget.mjs --record` also times the quick gate (`pnpm verify:fast`) against `QUICK_GATE_BUDGET_MS`, 30 s, and refuses to write a record when either run is over. On the 4-core loop environment the quick gate takes about 70 s (typecheck, lint, the related tests and the browser project's start-up), so the record cannot be written and the lockfile commit (Lingui, M9.19) still cannot land.

## Decision Outcome

`QUICK_GATE_BUDGET_MS` is **120 000 ms**, a margin of about 70 % over the measured 70 s. The human chose this over keeping 30 s and recording elsewhere. The staged budget (360 s, ADR-0158) and the cold-setup limit (600 s) do not move. The commit carries `Threshold-change:` citing this ADR. NFR-DX-002 and `performance.md` say 120 s.

## Consequences

- Good: a budget record can be written here; the lockfile rows (M9.19, M9.20, M11.54) are reachable.
- Bad: "quick" is no longer a sub-minute loop on this environment; it was already not one.
- Revisit: when the loop runs on a faster machine, lower both values (a tightening needs no ADR).

## Confirmation

`tests/harness/budget.test.mjs` reads both limits from `thresholds.mjs`; `node scripts/gates/check-budget.mjs` passes with a record under them.
