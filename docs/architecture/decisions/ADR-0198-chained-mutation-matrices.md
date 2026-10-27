---
status: accepted
date: 2026-10-27
decision-makers: harness (M18.124; cp13 F2, subject to independent review)
---

# ADR-0198 — Nightly mutation partitions run as chained matrices

Amends ADR-0174's matrix cap only; its sizing, completeness contract, floors and concurrency stay in force.

## Context and Problem Statement

Nightly 40470089950 at f0682fe failed in `mutation-plan`: the complete inventory makes 274
partitions at ADR-0174's target of 50 mutants (276 at a0f4881), and one GitHub matrix expands
to at most 256 jobs. `mutation-nightly.mjs plan` refused rather than drop scope, so no
partition ran and nothing qualified. The inventory grows with the code, so a resized target
would only delay the next overflow while making each job slower.

## Decision Drivers

- NFR-MNT-005: every package, source, test project and mutant; unchanged floors (ADR-0173/0174).
- Unchanged target (50), 60-minute jobs, zero retries and 8 concurrent partition jobs.
- Fail loudly, never partially, when the plan outgrows what the workflow can run.

## Considered Options

1. **Two chained matrix jobs (chosen).** `mutation-partitions` and `mutation-partitions-2` each
   expand one matrix of at most 256 jobs; the plan splits the partitions in order, evenly.
2. **Raise the target.** About 200 would fit today (ADR-0174 option 2), but an 83-mutant group
   already nearly used its hour, and growth would overflow again.
3. **Group several partitions per job.** Keeps one matrix, but multiplies a job's work and
   its timeout risk, and blurs which partition failed.

## Decision Outcome

`matrixChains` (scripts/harness/mutation-partitions.mjs) splits the plan's partitions into the
fewest matrices of at most `MATRIX_JOBS_MAX` (256) jobs, as evenly as possible, in plan order.
The plan step writes `matrix`, `matrix_2` and `chains`. `mutation-partitions-2` runs only when
`chains` is 2. Partition jobs run 8 at a time in all, as before: the first matrix runs 8 when it is the
only one, and each runs 4 when both do. Aggregation
needs both jobs and still fails on any missing, duplicate or failed partition. A plan beyond
`MATRIX_CHAINS` (2) matrices, that is over 512 partitions, fails the plan step and drops nothing;
a third chained job would then be added the same way.

## Consequences

- The current inventory (276 partitions) runs: 138 + 138.
- Total concurrency (8, whether one chain runs or two) and per-job limits are unchanged, so elapsed time grows only with the inventory.
- `nightly.yml` carries two copies of the partition job; ci-workflow.test.mjs checks both
  are identical in limits, retries and steps.

## Confirmation

Unit tests: one chain up to 256, an even in-order split of 257 to 512, and a refusal over 512.
The orchestration test reads the outputs by name and asserts a single chain for a small plan.
The workflow test checks both chained jobs, their concurrency (8 alone, 4 + 4 together), the `chains` guard and
aggregation's needs. The plan of the real inventory at a0f4881 gives 2 chains of 138.

## Links

- [ADR-0173](ADR-0173-complete-mutation-source-partitions.md), [ADR-0174](ADR-0174-mutation-partition-sizing.md)
- [M18 plan](../../milestones/M18.md)
