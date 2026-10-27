---
status: accepted
date: 2026-10-27
decision-makers: harness (M18.117; cp12 F1, subject to independent review)
---

# ADR-0197 — Windows verification gets its own CI envelope

## Context and Problem Statement

ADR-0191 bounds `pnpm verify` at 15 minutes inside a 35 minute job on all three OSes. Windows
had no headroom left: green full runs on main took 9 to 14 minutes (29727e4: 561 s, of which
harness-tests 530 s and Vitest 446 s run side by side on a 4 vCPU runner), and from 367e343 on
every Windows run stopped at 15:00. At ff4b166 harness-tests alone finished after 773 s with a
real failure (pack-goldens), and the remaining legs were cut off, so the run reported a timeout
instead of its full result. The same harness suite takes about 190 s of wall time on Linux; the
gap is Windows process spawning and file I/O in the sandboxed git and pnpm tests, not one test.

## Decision Drivers

- NFR-PORT-005: the full ladder must run and report on Windows; a cut-off run hides failures.
- Never weaken a gate: no test is skipped, retried or moved off Windows, and no threshold in
  `scripts/gates/thresholds.mjs` changes (`--all` has no latency budget; `PRECOMMIT_BUDGET_MS`
  bounds the staged pre-commit run and stays 900 s).
- Keep the Linux and macOS bounds, which still have headroom, as they are.

## Considered Options

1. **Run fewer harness tests on Windows.** Loses cross-platform qualification. Rejected.
2. **Split verify into several Windows jobs.** Doubles install and Chromium provisioning per job
   and changes the ladder's single-run contract (M2.22). Rejected for now.
3. **Widen only the Windows step to 25 minutes and its job to 45.** Chosen.

## Decision Outcome

In `ci.yml`, the verify job's `timeout-minutes` is 45 on `windows-latest` and 35 elsewhere, and the
`pnpm verify` step's is 25 on Windows and 15 elsewhere. Provisioning (15) and failure reports (2)
are unchanged, so the job keeps at least 3 minutes of outer headroom. This supersedes ADR-0191's
"15 minute pnpm verify step" for Windows only; the rest of ADR-0191 stands.

## Consequences and Confirmation

`ci-workflow.test.mjs` pins both expressions. A Windows run that grows past 25 minutes is a
failure to diagnose, not a reason to widen again without a new ADR. Speeding up the heaviest
harness files (api, layering, coverage: 105, 93 and 69 s on Linux) is the way to recover headroom.
