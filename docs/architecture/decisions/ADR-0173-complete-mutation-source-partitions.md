---
status: superseded by ADR-0174 (partition sizing only)
date: 2026-10-25
decision-makers: harness (M18.52, independent plan review)
---

# ADR-0173 — Complete mutation source partitions

## Context and Problem Statement

ADR-0146 requires splitting slow nightly mutation execution without raising its timeout.
M18.49–50 bind reports to independently collected complete inventories. A whole-DSL local
run retained all tests but exceeded 3600 seconds without a report. A diagnostic of its
largest source file, `patch/resolve.ts`, completed in 486.2 seconds with the exact expected
688 mutants and all discovered test projects. These local diagnostics are not hosted
nightly qualification and do not establish a whole-package score.

## Decision Drivers

- NFR-MNT-005: retain all nine pure packages, source inputs, tests and mutant identities.
- Keep the existing 60-minute job timeout, zero retries and score floors unchanged.
- Preserve raw engine reports; reject missing, failed, duplicate or partial execution.

## Considered Options

1. **One job per package.** Simple and consistent with ADR-0146, but the DSL diagnostic
   already exceeds the budget. Keep the package runner available for local work.
2. **Whole-source-file partitions (chosen).** Retains each source mutant exactly once
   while allowing independent jobs. Costs repeated baseline test runs and more artifacts.
3. **Reduce tests/mutators or increase the timeout.** Cheaper orchestration, but violates
   the existing completeness, test-integrity and timeout requirements; rejected.

## Decision Outcome

Supplement ADR-0146's package split with deterministic whole-source-file partitions.
Use the independent full checkout inventory to group files by package, targeting at most
800 mutants per partition. This is a scheduling target, not a score or performance limit:
a single larger file remains intact and must still pass the unchanged job timeout.
The current inventory suggests 51 groups; hosted execution must qualify the actual plan.

- Prove partitions are disjoint and exhaustive over expected source files and mutant IDs.
  Retain hashes for all source inputs, including zero-mutant files, and exact revision,
  runner and engine fingerprints. Reports must never define their own expected scope.
- Narrow only the mutation source list. Preserve every discovered test project, test
  selection rule, exclusion and mutator. Do not use diff scope, deduplication or sampling.
- Preserve existing full-package command behavior. A partial-source diagnostic must not
  claim to enforce a whole-package floor. Emit raw reports and failure metadata per group.
- Validate each group's complete mutant identities, statuses, test evidence and process
  result. A zero-valid group may contain only compile errors; a zero-valid complete package
  remains invalid. Missing/failed/unfinished groups fail aggregation even if other scores pass.
- Reassemble counts only after every expected group validates. Derive package scores from
  the complete mutant union; enforce the existing 70 percent minimum and recorded floors
  (including core's 100 percent). Preserve raw reports separately; label derived summaries.
- M18.10 wires the existing nightly workflow with fail-fast disabled, complete artifacts,
  unchanged timeout and no retries, then qualifies current-revision execution evidence.

## Consequences

- Good: incomplete execution cannot silently become a passing package score.
- Good: a slow package can be split without changing tests or mutant coverage.
- Bad: repeated baseline runs increase compute and artifacts; the target needs real timing
  evidence and does not guarantee every future source file fits the job budget.
- Neutral: survivors remain real findings. This decision neither lowers floors nor declares
  the diagnostic file's 71.4 percent score to be the DSL package's score.

## Confirmation

M18.52 tests deterministic exhaustive partitioning, unchanged runner configuration,
failed/partial/duplicate reports, zero-valid group versus package handling and aggregate
floor enforcement. Real source-partition probes compare all expected identities with raw
engine output. M18.10 requires complete current-revision nightly reports within the existing
job timeout; synthetic reports exercise orchestration only and cannot qualify mutation.

## Links

- [ADR-0146](ADR-0146-mutation-testing-tzap.md)
- [M18 plan](../../milestones/M18.md)
- [Testing standard](../../standards/testing.md)
