---
status: accepted
date: 2026-09-28
decision-makers: Fluxion maintainers (user decision 2026-09-28)
---

# ADR-0146 — Mutation testing with tzap instead of StrykerJS

## Context and Problem Statement

ADR-0008, tech-stack.md and testing.md §6 name StrykerJS (vitest-runner) as the nightly mutation
tool, with floors in `.harness/baselines/mutation.json` from M20 (NFR-MNT-005). Until now nothing
ran: the nightly `mutation` job printed SKIP, and M3's reviews relied on hand-made mutants. The
user asked to use tzap (github.com/huyz0/tzap) for mutation testing. Which tool runs mutation
testing, when, and with what floors?

## Decision Drivers

- Agent-written tests need a check that they constrain the code (testing.md rule 18).
- Runs must be cheap enough to scope to a diff and to run per milestone, not only nightly.
- Works with the repo's runner (Vitest 5, projects, `@fluxion/source` condition) and monorepo.
- A licence the policy allows for dev tools (tech-stack §3).

## Considered Options

1. StrykerJS + vitest-runner (the planned tool).
2. tzap (`@huyz0/tzap`).
3. Hand-made mutants in reviews only.

## Decision Outcome

Chosen option **2, tzap**, the user's decision.

- Root devDependency `@huyz0/tzap` (Apache-2.0). tzap drives the repo's own Vitest warm, runs a
  diff-scoped analysis (`--from <ref>`), and writes StrykerJS-compatible reports
  (mutation-testing-elements), so Stryker's viewer and dashboards still work.
- `pnpm mutate [--package <dir>] [--from <ref>] [--out-dir <dir>] [--check]` runs
  `scripts/harness/mutate.mjs`, which runs tzap on the package's source files and writes
  `tzap.json` and each package's score; without `--package` it covers the pure packages, and `--check`
  fails when a package is below its floor.
- The nightly `mutation` job runs tzap on the pure packages and fails below a floor.
- Floors live in `.harness/baselines/mutation.json` (`packages.<dir>.score`) and only move up:
  `check-drift` refuses a lowered floor without `Threshold-change:` (testing.md rule 17).
  NFR-MNT-005's 70 % is the minimum; core's floor starts at its triaged score (M4.8).
- Message text is not the contract (diagnostic codes are): a string mutant in a human message is
  disabled with `// tzap disable next-line StringLiteral: message text is not the contract`.
  Equivalent mutants are disabled with the reason. Disabled mutants are reported, not scored.
- Survivors in touched files are reviewed (testing.md rule 18); a reviewer may ask for
  `pnpm mutate --package <dir> --from <base>` output in the review packet.

### Consequences

- Good, because mutation testing runs from M4, not M20, and a diff-scoped run takes seconds.
- Good, because the reports stay in Stryker's format.
- Bad, because tzap is young (0.1.x); its verdicts are checked against StrykerJS by its own parity
  suite, and a wrong verdict here would show as a survivor a test obviously kills.
- Neutral: the TS 6 pin no longer needs Stryker (tech-stack row updated).

### Confirmation

m4-complete runs `pnpm mutate --package packages/core` and checks the score against the floor;
a harness case shows check-drift refusing a lowered floor; the nightly job runs tzap.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| StrykerJS | mature, widely used | Vitest path re-runs test files per mutant; slow on a monorepo; nightly only |
| tzap | warm runner, diff scope, Stryker-format reports | young |
| Hand-made only | no tool | covers only what the author thinks of |

## More Information

tzap docs: usage, mutators, status (github.com/huyz0/tzap/docs). Amends ADR-0008 (toolchain),
tech-stack.md (Mutation row), testing.md §6, ci-cd.md (nightly), M20 plan row 15.
