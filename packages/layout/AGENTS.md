# @fluxion/layout — agent notes

Layout interface, built-in algorithms, worker host, constraint/overlap pass, text-measure port.

## Rules

- Layer L2: import only from lower layers (docs/architecture/01-overview.md); enforced by `check-layering`.
- **Pure package**: no DOM, timers, `Date.now`, `Math.random`, network or `node:*`. Inject ports (`Clock`, `Random`, `TextMeasurer`, `FileIO`).
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 (node) only — no DOM in tests.
