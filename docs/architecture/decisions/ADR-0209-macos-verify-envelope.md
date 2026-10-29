---
status: accepted
date: 2026-10-29
decision-makers: harness (M18.194; ci 40894960957, subject to independent review)
supersedes: ADR-0191 (the macOS verify step and job bounds only)
---

# ADR-0209 — macOS verification gets its own CI envelope

## Context and Problem Statement

ADR-0191 bounds `pnpm verify` at 15 minutes inside a 35 minute job, and ADR-0197 widened only
Windows (25 of 45). macOS then ran out of headroom the same way. Its green verify step took 754 s
at 084008f, 773 s at 475402c and 873 s at 8cae07a. In ci 40894960957 at e3f6e36 it stopped at
15:00 with no failing check, after M18.191–193 added about 30 s of harness tests. On the 3 vCPU
macOS runner every leg after the build runs side by side. At 8cae07a, `test` (Vitest with coverage)
took 831 s, `harness-tests` 743 s and `attw` 341 s, so the step ends with Vitest. A cut-off run
reports a timeout instead of the ladder's result.

## Decision Drivers

- NFR-PORT-005: the full ladder must run and report on macOS; a cut-off run hides failures.
- Never weaken a gate: no test is skipped, retried or moved off macOS, and no threshold in
  `scripts/gates/thresholds.mjs` changes. `--all` has no latency budget; `PRECOMMIT_BUDGET_MS`
  (NFR-DX-002) bounds the staged pre-commit run and stays 900 s.
- Keep the ubuntu bound (about 8 minutes used) as it is.

## Considered Options

1. **Move coverage collection off macOS and Windows verify.** It shortens the critical path, but it
   moves a gate leg, and stream 6 is still measuring it. It needs Huy's decision.
2. **Pack attw/publint once (M18.186).** Those legs end long before Vitest does, so this only frees
   CPU. The gain is unproven and probably under 2 minutes.
3. **Widen only the macOS step to 20 minutes and its job to 40.** Chosen as the stopgap.

## Decision Outcome

In `ci.yml`, the verify job's `timeout-minutes` is 45 on `windows-latest`, 40 on `macos-latest` and
35 on `ubuntu-latest`. The `pnpm verify` step's is 25, 20 and 15. Provisioning (15) and failure
reports (2) are unchanged, so the job keeps the same 3 minutes of outer headroom as Windows. This
supersedes ADR-0191's 15 minute step for macOS only. ADR-0197 stands.

## Consequences and Confirmation

`ci-workflow.test.mjs` pins both expressions. A macOS run that grows past 20 minutes is a failure
to diagnose, not a reason to widen again without a new ADR. Headroom comes back by shortening the
critical path: where coverage is collected (option 1), and harness-test time (M18.157).
