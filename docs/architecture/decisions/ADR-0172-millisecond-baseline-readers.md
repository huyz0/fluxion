---
status: accepted
date: 2026-10-25
decision-makers: harness (M18.9; M17 final-delta D3)
---

# ADR-0172 — Retain only consumed millisecond baselines

## Context and Problem Statement

ADR-0170's historical “What stays” paragraph names M13 and M17 as readers of
`perf-baseline.json`. M17.42 moved hosted M13 measurements to calibration units;
M17's current gate measures absolute limits without reading that file. Sixteen
unused entries now imply regression enforcement that does not exist.
This supplements that reader inventory; ADR-0170's calibration decision remains.

## Decision Drivers

- NFR-PERF-005: preserve absolute budgets and the 15 percent calibrated regression limit.
- Keep every consumed baseline unchanged; remove misleading unused records.
- Preserve accepted ADR history rather than rewriting its original rationale.

## Considered Options

1. **Keep all entries.** Preserves historical measurements in the working file,
   but suggests readers that do not exist. Git already preserves their history.
2. **Retain only consumed entries (chosen).** Makes the file reflect executable
   policy; future readers must explicitly record their baselines. No measured
   limit or actual regression check is removed.
3. **Add readers for all entries.** Introduces new regression checks and fixture
   qualification beyond this cleanup. New checks require their own task/evidence.

## Decision Outcome

Retain `layered-100: 58` and `layered-500: 211`, byte-for-byte numeric values.
Remove the sixteen circular, force, mindmap, packing, radial, swimlane, timeline
and tree entries. These are historical millisecond records, not thresholds.

The current reader inventory is:

| File / path | Reads | Enforcement |
|---|---|---|
| M13 `benchLeg`, local branch | Two retained millisecond entries | Requires numeric registration; measures p99 against `LAYOUT_*_NODES_MS`, not the stored value |
| M13 `benchLeg`, CI branch | `perf-baseline.calibrated.json` | Median p99 budget and median calibration units within 15 percent |
| Nightly `scripts/ci/perf-baseline.mjs` | `perf-baseline.calibrated.json` | Same calibrated judgment, five samples, no retries |
| M17 and M18 layout legs | No millisecond baseline entries | Absolute thresholds; only valid circular timing advisory per ADR-0171 |
| `check-drift.mjs` | Both baseline files | Change-policy protection, not a measurement reader |

No calibrated entry, frozen workload, sample count, absolute threshold or
correctness check changes. A `Threshold-change:` trailer cites ADR-0170 and this
supplement because the drift gate also protects removal of unused entries.

## Consequences

- Good: the remaining inventory has executable readers and honest documentation.
- Good: removing a required entry still fails M13's local leg before measurement.
- Bad: historical unused numbers require Git history to retrieve.
- Neutral: local stored millisecond values remain registration evidence, not a
  claim that local runs enforce regression against those numbers.

## Confirmation

`tests/harness/perf-baseline.test.mjs` runs the real M13 local legs with synthetic
benchmark processes, compares measured names to all retained entries, then removes
each entry and requires its leg to fail before measuring. Synthetic reports test
reader wiring only; they do not qualify performance. Existing calibrated tests
and drift tests retain regression and baseline-change protection.

## Links

- [ADR-0170](ADR-0170-perf-calibration-units.md)
- [Performance standard](../../standards/performance.md)
- [M18 plan](../../milestones/M18.md)
