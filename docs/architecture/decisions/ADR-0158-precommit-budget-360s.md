---
status: superseded by ADR-0163
date: 2026-10-06
decision-makers: the human (answer to the budget question, 2026-10-06: "Raise the 120 s budget"), recorded by harness (M11.69; amends NFR-DX-002, weakens `PRECOMMIT_BUDGET_MS`)
---

# ADR-0158 — The pre-commit budget is 360 s

## Context and Problem Statement

NFR-DX-002 limits the full pre-commit gate to 120 s, and `check-budget.mjs --record` refuses a lockfile commit unless a fresh record fits. The staged ladder grew with the player,
editor and studio work of M9 to M11. On the only 4-core environment the loop runs in, a lockfile commit takes about 315 s (the one record on file, 30.7 s, came from a Windows
machine with Node 26 and no longer represents the ladder). M9.19 and M9.20 (Lingui, NFR-I18N-001, R1 box 1) change the lockfile and so cannot land. `ladder-scope.mjs` already
narrows the ladder to what a staged path can affect; no further narrowing keeps a lockfile commit under 120 s, because a dependency change runs everything it may touch.

## Decision Outcome

`PRECOMMIT_BUDGET_MS` is **360 000 ms** (6 min), a margin of about 15 % over the measured 315 s. The human chose to raise the budget rather than to record elsewhere or to descope
NFR-I18N-001 from R1. This weakens a gate, so the commit carries `Threshold-change:` citing this ADR. The quick gate (30 s) and the cold-setup limit (600 s) do not move.
NFR-DX-002, `docs/standards/performance.md` and `docs/standards/ci-cd.md` say 360 s. The budget is still enforced: `check-budget.mjs` fails a record over it, and the staged
ladder fails over it.

## Consequences

- Good: lockfile commits (Lingui, `@lhci/cli`) can land; R1 box 1 and the M11 review are reachable.
- Bad: a commit can take up to six minutes; the habit of small, scoped commits (`ladder-scope.mjs`) still keeps most commits far below.
- Revisit: when the loop runs on a faster machine, lower the value again (a tightening needs no ADR).

## Confirmation

`tests/harness/budget.test.mjs` reads `PRECOMMIT_BUDGET_MS` from `thresholds.mjs`; `node scripts/gates/check-budget.mjs` passes with a record at or under 360 s.
