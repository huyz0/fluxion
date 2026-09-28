# @fluxion/core — agent notes

Document store (records + signals), transactions, commands, undo/redo, queries, registries.
Design: docs/architecture/03-core-engine.md; semantics: ADR-0014.

## Rules

- Layer L1: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- **Pure package**: no DOM, timers, `Date.now`, `Math.random`, network or `node:*`. Inject ports (`Clock`, `Random`, `TextMeasurer`, `FileIO`).
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag; a changed surface updates `api/core.api.md` (`check-api.mjs --update`) and 03 §1–§4 (harness case "03 names core exports").

## Invariants (ADR-0014)

- `transact` is the only write path, and only commands (`ctx.store.transact`), `history.ts` and `fork.ts` call it (`tests/harness/architecture.test.mjs`).
- Writes return a `Result` (ADR-0144); a failed transaction leaves records, indexes, signals and history untouched. Throwing is for programmer errors only.
- Records are frozen values; nothing mutates a record or a map another store may share (`SharedRecordMap` copies on first write).
- Undo is exact: history stores net diffs; undo/redo replay them without hooks. Any change to history, hooks or merging must keep the NFR-REL-003 properties green.
- Hooks are sorted by key and must reach a fixed point (a pass that changes nothing); they never read clocks or randomness.
- Validation stays on in dev, test and benches (`validate: false` is for production builds only; the m3 gate scans `bench/`).
- New error codes go in `errors.ts` (`CoreErrorCode`) with a documented `FLX_*` diagnostic in `@fluxion/schema`.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 (node) only — no DOM in tests.
- Benches: `bench/*.bench.ts` (Vitest 5 `context.bench`), run with `pnpm bench`; `async: false` on every bench (tinybench otherwise calls the function once outside its hooks).
