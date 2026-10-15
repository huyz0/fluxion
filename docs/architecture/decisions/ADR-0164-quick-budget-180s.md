---
status: accepted
date: 2026-10-13
decision-makers: the human (answer to the quick-budget question, 2026-10-13: "Raise quick to 180 s"), recorded by harness (M13.25; amends NFR-DX-002, weakens `QUICK_GATE_BUDGET_MS`; supersedes ADR-0161)
---

# ADR-0164 — The quick-gate budget is 180 s

Supersedes ADR-0161.

## Context and Problem Statement

ADR-0161 set `QUICK_GATE_BUDGET_MS` to 120 s, about 70 % over the 70 s it had measured. The quick gate (`pnpm verify:fast`: `vitest run --changed`, typecheck and lint of changed files) is timed by `check-budget.mjs --record`, which a lockfile commit needs. The recorded figure had grown to 113 s by M12 (7 s of headroom). On 2026-10-13, with the machine idle (load average under 3), three recordings in a row measured 123.6 s, 125.8 s and 128.1 s, all of them failing the budget with the same staged content that had passed at 113 s. M13.5 (linking `zod` to `@fluxion/layout`) and M13.8 (adding `@dagrejs/dagre`) change the lockfile, so neither could land.

## Considered Options

1. **Raise the budget to 180 s**, about 40 % over the 128 s measured, so ordinary variation of this 4-core container does not block a lockfile commit.
2. **Keep 120 s and make the quick gate faster.** Uncertain gain, and it puts a profiling row in front of every M13 dependency.
3. **Avoid lockfile changes in M13.** Not possible: `layered` is backed by dagre (ADR-0034).

## Decision Outcome

Option 1. `QUICK_GATE_BUDGET_MS` is **180 000 ms**. This weakens a gate, so the commit carries `Threshold-change:` citing this ADR. NFR-DX-002, `docs/standards/performance.md` and `docs/standards/ci-cd.md` say 180 s. The pre-commit budget (480 s, ADR-0163) and the cold-setup limit (600 s) do not move. The budget is still enforced: `check-budget.mjs` fails a record over it, and the quick run fails over it.

## Consequences

- Good: lockfile commits land again (M13.5, M13.8).
- Bad: "quick" is a three-minute loop on this environment, not a minute-scale one.
- Revisit: lower the value when the loop runs on a faster machine (a tightening needs no ADR), or when the quick run is profiled and trimmed.

## Confirmation

`tests/harness/budget.test.mjs` reads both limits from `thresholds.mjs`; `node scripts/gates/check-budget.mjs` passes with a record under them.
