---
status: accepted
date: 2026-10-23
decision-makers: harness (M17.25; M17 final F1; changes how NFR-PERF-005's regression budget is judged, not the budget)
---

# ADR-0170 — Judge the layout regression budget in calibration units

## Context and Problem Statement

NFR-PERF-005 holds the layout benches to absolute budgets (100-node layered < 200 ms, 500-node < 2 s) and to a ±15 % regression budget against a stored baseline. The nightly perf job ran on `ubuntu-latest`, so each run was on whichever machine the pool handed out. On the same code the median-of-3 `layered-500` p99 read 238 ms (2026-10-21), 172 ms (2026-10-22) and 136 ms (2026-10-23, run 39849966524), against a regression limit of 243 ms (baseline 211 × 1.15). Retrying, dropping the bench or raising the baseline would hide a real regression as well as the noise. Performance standard rule 20 asks for a fixed runner, which the project does not have; buying one is a human cost decision.

## Decision Drivers

- The budgets (`LAYOUT_*_NODES_MS`), the tolerance (`PERF_REGRESSION_TOLERANCE_PCT`) and the stored ms baselines do not move.
- A 15 % regression on the code should still fail the night it lands, on any runner.
- No new service, runner or cost.

## Considered Options

1. **More samples or retries in ms.** Median-of-3 in one job did not help: the spread is between machines, not within a run.
2. **A fixed or larger runner.** Meets rule 20 as written; a recurring cost the human owns. Still open; this ADR does not rule it out.
3. **Calibration units (chosen).** Run a frozen workload in the same Vitest process as each bench and judge the bench's p50 as a multiple of the workload's p50.

## Decision Outcome

Option 3.

- **The workload:** `packages/layout/bench/calibration.bench.ts`, a seeded layered-graph sweep shaped like a layout (objects, maps, sorts) that imports nothing from the project. It is frozen: a change re-scales every calibrated baseline, so it needs a new ADR and a re-record in the same commit.
- **The reading:** for each bench, `scripts/ci/perf-baseline.mjs` runs the calibration file and the bench file in one `vitest bench` process, one file after the other, `RUNS` (5) times. A run's reading is the bench's p50 over the calibration's p50 (calibration units); the median of the runs is judged. p50, not p99: a p99 of ~20 samples is the slowest sample, which one GC pause sets (the p99 ratio moved up to 60 % between laptop runs where the p50 ratio moved about 6 %).
- **The verdict:** a bench passes when its median p99 is within its absolute budget (`t(key)`, ms: the requirement itself) and its median units are within `PERF_REGRESSION_TOLERANCE_PCT` over its entry in `perf-baseline.calibrated.json`. A bench without an entry fails and prints the units to record.
- **Recording:** entries are recorded from a nightly run on the CI runner, never from a laptop; raising one needs a `Threshold-change:` trailer (rule 19). Until M17.38 makes check-drift refuse an upward move in `perf-baseline.calibrated.json` (and `perf-baseline.json`) without the trailer, that rule rests on review.
- **What stays:** `perf-baseline.json` keeps its ms entries for the completion gates' bench legs (M13, M17); the nightly no longer judges against them. A completion gate dispatched on a hosted runner (`milestone-gate.yml`) still judges ms and can meet the same flake; moving those legs to calibration units is backlog M17.42.
- **Acceptance of M17.25:** three consecutive nightly runs read `layered-500` within 15 % of each other in calibration units.

## Consequences

- Good: a regression in the layout code moves the units on any runner; a slower machine moves both readings and cancels out.
- Neutral: the perf job runs the calibration workload beside every bench (about 2 s each, 25 runs); rule 20 and NFR-PERF-005's verification text name this ADR.
- Bad: a change that slows the JS engine for both workloads alike (a Node upgrade) is not seen as a regression; the absolute budgets still catch a large one. A runner whose CPU favours one kind of work over the other skews the units; three-in-a-row is the check that it does not.
