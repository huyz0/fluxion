# @fluxion/layout — agent notes

Layout interface (v1, ADR-0033), the built-in algorithms `grid`, `stack` and `layered` (dagre), the pipeline (pins, overlap, snap), nested containers, the worker host, the `layout.arrange` commands.

## Rules

- Layer L2: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- **Pure package**: no DOM, timers, `Date.now`, `Math.random`, network or `node:*`. Inject ports (`Clock`, `Random`, `TextMeasurer`, `FileIO`).
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 (node) only — no DOM in tests.

## Local rules

- Determinism is the contract (FR-LAY-008): canonical order (`order`, then id), the seeded `ctx.rng` only, fixed iteration counts, snap to 0.5 px on the way out. Ids such as `constructor` or `__proto__` must work: use `Map`, never plain objects, for ids.
- Worker glue (`Worker`, `postMessage`, `self`) lives only under `src/worker`; the gate `m13-complete` checks it.
- The overlap pass is our own sweep (ADR-0034); do not add a solver without an ADR.
- Smart templates (ADR-0047) live in `src/templates/`: they return drafts, never records, and style only with theme tokens and the slot role as `variant`.
- A change to a built-in's output needs a golden update with the reason in the commit (and a `version` bump once the algorithm has shipped).
