---
status: superseded by ADR-0166
date: 2026-10-15
decision-makers: the human (answer to the budget question, 2026-10-15: "Raise staged to 600 s"), recorded by harness (M13.26; amends NFR-DX-002, weakens `PRECOMMIT_BUDGET_MS`; supersedes ADR-0163)
---

# ADR-0165 — The pre-commit budget is 600 s

Supersedes ADR-0163.

## Context and Problem Statement

ADR-0163 set `PRECOMMIT_BUDGET_MS` to 480 s, about 17 % over a worst-case staged run of 410 s, and the M12 record stood at 446 s. `check-budget.mjs --record` times the worst-case staged commit (`worst-case.mjs`) and a lockfile commit needs a fresh record. On 2026-10-13, on an idle 4-core container, three recordings measured 523.5 s, 534.0 s and 541.5 s, and the quick gate drifted the same way (113 s at the M12 record, 129 to 140 s now). Both moved by about 20 % on unchanged code, so the container is slower than it was; the repository did not get 20 % heavier. M13.5 (linking `zod` to `@fluxion/layout`) and M13.8 (adding `@dagrejs/dagre`) change the lockfile and could not land.

## Considered Options

1. **Raise the budget to 600 s**, about 11 % over the 541 s measured, as ADR-0163 did over its 410 s.
2. **Wait and retry** on a faster container. Nothing says when, and the M13 lockfile rows would stay parked.
3. **Narrow the worst case.** It is by definition the commit scoping cannot narrow (M8.20).

## Decision Outcome

Option 1. `PRECOMMIT_BUDGET_MS` is **600 000 ms** (10 min). This weakens a gate, so the commit carries `Threshold-change:` citing this ADR. NFR-DX-002, `docs/standards/performance.md` and `docs/standards/ci-cd.md` say 600 s. The quick-gate budget (180 s, ADR-0164) and the cold-setup limit (600 s) do not move. The budget is still enforced: `check-budget.mjs` fails a record over it, and the staged ladder fails any run over it.

## Consequences

- Good: lockfile commits land again (M13.5, M13.8).
- Bad: the worst-case commit may take up to ten minutes. Scoped commits stay at three to four minutes.
- Revisit: lower the value when the loop runs on a faster machine (a tightening needs no ADR), or when the harness files are split further.

## Confirmation

`tests/harness/budget.test.mjs` reads both limits from `thresholds.mjs`; `node scripts/gates/check-budget.mjs` passes with a record under them.
