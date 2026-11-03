---
status: accepted
date: 2026-11-03
decision-makers: packs stream (M18.256, Fixes-ci 41639993998), subject to independent review
amends: ADR-0197 (its option 2, splitting Windows verification, rejected "for now")
---

# ADR-0214 — On Windows the full ladder's harness-tests leg runs in a job of its own

## Context and Problem Statement

ADR-0197 gave Windows verification 25 of 45 minutes and named speeding up the heaviest harness
files as the way to keep headroom. The step's Windows times since have been 782.5 to 1414.5 s
(M18.256's progress entry), and ci 41639993998 was killed at the 25-minute limit. The wall time is
set by the two longest legs, Vitest (`test`, 752 to 1360 s) and the harness suite
(`harness-tests`, 679 to 1207 s), running side by side with about twenty other legs on a 4 vCPU
runner; every leg scales together with runner speed (about 1.8x between runs), so trimming single
harness files does not buy back the 20 % the row asks for.

## Decision Drivers

- NFR-PORT-005: the whole ladder still runs and reports on Windows, every leg, every run.
- Never weaken a gate: no leg is dropped, skipped without another job running it, retried, or
  given a longer timeout; no threshold changes.
- NFR-DX-004: the Windows verify step under 80 % of its limit.

## Considered Options

1. **Run the harness-tests leg in its own Windows job.** `verify (windows-latest)` runs the ladder
   with `--skip harness-tests`; a new job `harness tests (windows-latest)` runs it with
   `--only harness-tests`, which keeps the ladder's ordered prefix (typecheck, build) the leg reads.
   Each job has verify's bounds (a 25-minute step in a 45-minute job). Chosen.
2. **Make the harness files faster.** Worth doing, but each heavy file is a few percent of a leg
   whose time moves 1.8x with the runner; not enough alone.
3. **Raise the Windows step limit again.** Excluded by ADR-0197 and the row.

## Decision Outcome

- `precommit.mjs --all` takes `--skip <legs>` or `--only <legs>` (`ladder-split.mjs`). Either
  needs `--all`; both together, an empty list or an unknown leg exit 2. A leg left to the other job
  prints `SKIP <leg> — --skip: run by another CI job` (or `--only`), never a silent pass. Local
  `pnpm verify` and the commit hook are unchanged.
- `ci.yml`: the Windows verify step runs `precommit.mjs --all --skip harness-tests`; the
  `harness-windows` job runs `precommit.mjs --all --only harness-tests`, installs Chromium (the
  font-engine harness test launches it) and uploads its failure reports. `ci-ok` needs it, so the
  run, and any CI evidence read from it, is red when it fails.
- Linux and macOS still run the whole ladder in one step (`pnpm verify`).

### Consequences

- Good: the Windows verify step no longer carries the harness suite's 3 workers beside Vitest;
  each leg runs on its own runner.
- Bad: one more Windows job per ci run (install, Chromium, typecheck and build repeated: a few
  minutes of runner time and one more job in the queue).
- Confirmation: `ci-workflow.test.mjs` pins the split and the bounds, `ladder-split.test.mjs` that
  the two jobs together run every leg once; M18.256 records three consecutive Windows verify steps
  under 20 minutes.
