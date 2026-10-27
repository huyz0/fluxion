---
status: accepted
date: 2026-10-25
decision-makers: harness (M18.58, independent plan review required before implementation)
---

# ADR-0174 — Mutation partition sizing

Supersedes ADR-0173's default sizing only; its completeness contract remains in force.
Amended by [ADR-0198](ADR-0198-chained-mutation-matrices.md): the 256-job cap now applies per chained matrix.

## Context and Problem Statement

Nightly 40193583176 at 88965d82 finished with 37 successful mutation partitions and
14 confirmed one-hour timeouts. Aggregation failed on missing core-1 evidence. Even a
successful 83-mutant schema group took 52m51s. These results do not qualify package floors.
M18.56 split the timed-out builtin source into 218/129 operations without dropping any
of its original 347 operations. The 218-operation diagnostic completed in 30m39s and
exposed 19 survivors addressed by M18.57. Partial diagnostics are not nightly qualification.

## Decision Drivers

- NFR-MNT-005: retain all nine pure packages, every source input and mutant identity.
- Retain 60-minute jobs, zero retries, existing test projects and package score floors.
- Reduce combined work while retaining the existing 256-job matrix cap and concurrency 8.

## Considered Options

1. **Keep target 800.** Less setup and fewer artifacts, but 14 observed groups timed out.
2. **Target 200.** Produces 162 groups on the current inventory, with less overhead than 50,
   but combines more work despite an 83-mutant group already nearly using its full budget.
3. **Target 50 (chosen).** Produces 236 groups on the current 36193-mutant inventory. It
   reduces combined work within the existing matrix cap, at the cost of more setup/artifacts.
4. **Target 1.** Would produce 275 whole-source groups, exceeding the unchanged matrix cap.
5. **Raise timeouts or drop tests/mutants.** Violates the existing requirements; rejected.

## Decision Outcome

Use one shared default target of 50 mutants for deterministic whole-source partitions in
planning, CLI execution, programmatic execution and aggregation. Keep explicit target
arguments supported. A larger source remains whole; this target is a scheduling heuristic,
not a guarantee that each source fits its budget. No threshold exception is introduced.

Retain ADR-0173's exhaustive/disjoint inventory checks, every source hash and mutant ID,
all discovered test projects, exclusions, mutators, raw reports and exact execution identity.
Missing, duplicate, failed, malformed or unfinished groups fail aggregation. Apply the
unchanged 70 percent minimum and recorded floors, including core's 100 percent, only to
complete package unions. Preserve zero-valid handling, timeouts, concurrency and zero retries.

## Consequences

- Smaller combined groups may fit the budget; oversized sources still require real evidence.
- More baseline setup and artifacts increase total compute and elapsed queue time.
- Further source refactoring or stronger tests may be needed; M18.10 remains open until
  complete current-revision execution and unchanged package floors qualify.

## Confirmation

An isolated orchestration fixture with 51 one-mutant core sources must yield exhaustive
50/1 groups through the actual default matrix, CLI and programmatic execution, then complete
aggregation. Assert all test projects and raw reports remain; missing/mismatched groups fail.
Deliberately drift each default consumer and observe failure. Keep explicit-target tests.
Compare the real complete inventory and matrix cap before publication. Synthetic reports
qualify orchestration only. After independent review and local gates, one current-revision
nightly must supply actual runtime and complete-package evidence; no duplicate dispatch.

## Links

- [ADR-0173](ADR-0173-complete-mutation-source-partitions.md)
- [M18 plan](../../milestones/M18.md)
- [Testing standard](../../standards/testing.md)
