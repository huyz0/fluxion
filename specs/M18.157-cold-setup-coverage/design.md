# Design

- precommit.mjs: `--no-coverage`, with `--all` only (exit 2 otherwise); the test step runs `vitest run` and logs that
  the verify jobs gate coverage. check-budget's cold setup runs `pnpm verify --no-coverage`.
- vitest.config.ts: node project groupOrder 0, browser 1 on every OS (on Windows the one-worker node project still runs last, M18.276); browser fileParallelism with maxWorkers 3 on Linux.
- Harness: licenses' two real-repo runs give way to a fixture (the ladder's licenses step runs the gate on the repo);
  workspace-shape's type-check cases share one sandbox and one full tsc -b; layering's real-tree and lower-import cases
  share one run.
- Pins: ci-workflow.test (only check-budget passes the flag; `verify`, `test:coverage` and ci-ok's needs unchanged),
  windows-test-scheduling.test (order and Linux width), budget.test (the cold verify's arguments).

Rejected (ADR-0216): a separate coverage job; cuts alone; `isolate: false`.

Risks: Linux browser files under contention (the first CI runs are the evidence); the cold number no longer covers a
coverage run.
