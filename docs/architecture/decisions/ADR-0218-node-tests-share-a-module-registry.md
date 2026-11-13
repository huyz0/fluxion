---
status: accepted
date: 2026-11-13
decision-makers: harness (M18.290, after the ADR-0176 diagnostic review; under Huy's 2026-11-05T11:04:52Z delegation), subject to independent review
---

# ADR-0218 — Node test files share a module registry; files that change process-wide state stay isolated

## Context and Problem Statement

ci's cold setup read 604 s against COLD_SETUP_MAX_MS 600 s at 9ec6eef (ci 43351801498) on the slow
runner class, where every reading since M18.157's attempt 4 sat 16–27 s under the limit. After the
build the ladder runs its lanes at the CPU limit of the 4-core runner, and the test lane is the
critical path (534 s there). The cp50 record forbids raising the limit, removing or skipping a step,
or narrowing a check, and ADR-0176 asked for an independent diagnostic review before a fifth
attempt (/mnt/project-files/stream6/m18-290-diagnosis.md). It found that 39 % of the node project's
time is loading each file's imports again, because Vitest gives every test file a fresh module
registry (`isolate: true`). ADR-0216 had deferred this option because four files failed without
isolation.

## Decision Drivers

- Every test, assertion, step, threshold and the coverage gate stay as they are.
- A file that changes process-wide state must not leak it into another file's run.
- Mutation testing reads the same verdicts as before.

## Considered Options

1. **Keep `isolate: true`.** The cold setup stays at the limit on the slow class.
2. **`isolate: false` for the whole node project.** 5 files fail (the CLI render host and
   connectors and three SVG witness files): they mock modules or stub globals.
3. **`isolate: false` for the node project, and a `node-isolated` project for the files that
   change process-wide state, chosen by scanning their source.** Chosen.

## Decision Outcome

vitest.config.ts runs the node project with `isolate: false`. tools/vitest/isolation.mjs scans each
node test file at config load. A file that calls `vi.mock`, `vi.doMock`, `vi.resetModules`,
`vi.stubGlobal`, `vi.stubEnv`, `vi.useFakeTimers` or `vi.setSystemTime`, spies on `globalThis`,
`process`, `console` or a built-in global (`JSON`, `Math`, `Date`, …), assigns to `globalThis`,
`process.env` or a built-in's member (`Math.random = …`),
changes the cwd, or adds a process-level error or signal handler leaves the node project. It runs
in `node-isolated`, with the default isolation, the same environment, the same group order and, on
Windows, one file at a time. That is 26 files today. Being computed rather than listed, the set
follows new files without a hand-kept list.

Commands that ran `--project node` now run `--project 'node*'`: precommit's staged coverage run,
the milestone gates, sync-versions and ci's CLI and MCP e2e step. A named file is found in either
project. scripts/harness/mutate.mjs sets `FLUXION_TEST_ISOLATE=1`, and the node project then
isolates as before, so tzap's per-test coverage and verdicts do not change.

Measured on a 4-core machine: `vitest run --project node` 150 s → `--project 'node*'` 93 s, with
3360 of 3360 tests passing (also with `--sequence.shuffle.files`) and the same 2918 listed tests split as 2776 + 142. The diagnostic
review measured the full ladder's test lane at 324 → 226 s and harness-tests at 384 → 334 s, and
projected about 470 s on the slow class.

### Consequences

- Good: about a third less CPU in the node project, on every ladder (local, ci verify, cold setup).
- Bad: a file that changes shared state in a way the markers do not see could pass or fail
  because of the file before it in the same worker. tests/harness/test-isolation.test.mjs pins the
  markers with positive and negative cases, and the config's split. Such a failure, when it shows,
  is fixed by adding the marker, not by turning isolation back on everywhere. M18.291 adds a
  nightly node run with `--sequence.shuffle.files` and a logged seed, so an order dependence
  shows there before it shows as an intermittent red on main.
- A test that reads module-level state (a cache, a registry) now sees what earlier files in the
  same worker left there, so it depends on the file order within its worker. The markers do not
  catch this; M18.291's shuffled nightly does.
