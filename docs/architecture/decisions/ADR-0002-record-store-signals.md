---
status: accepted (the editor UI state sentence superseded by ADR-0028)
date: 2026-09-26
decision-makers: Fluxion maintainers
---

# ADR-0002 — Normalized record store with signals and record-diff undo

## Context and Problem Statement

The document is mutated by editor tools, AI patches, FluxScript compilation, MCP tools and plugins.
It must support undo/redo for everything (FR-EDT-006), fine-grained re-rendering of thousands of
elements (NFR-PERF-001/002), headless use in Node (CLI/MCP), and later real-time collaboration
(NFR-MNT-006). What state model should hold the document?

## Decision Drivers

- One write path, so every mutation has the same undo, validation and audit semantics.
- Per-record reactivity: changing one element must not re-render the screen.
- Framework-free and pure (runs in Node and workers, no DOM) — NFR-MNT-001.
- CRDT readiness: operations expressible as record puts/deletes, no positional arrays (FR-DOC-010).
- Undo speed < 16 ms for 5 000 records (NFR-PERF-006).

## Considered Options

1. Nested document tree + Immer patches, in Redux/Zustand
2. MobX observable object graph
3. Jotai atoms per record
4. A CRDT (Yjs/Loro) as the primary store from day one
5. Own normalized record store (`Map<id, record>`) + `alien-signals` + record-diff undo

## Decision Outcome

Chosen option: **5 — own record store in `@fluxion/core`**. Records are immutable values in a flat
map, and `transact()` is the only write path. Each transaction emits a `Diff`
(`puts`/`deletes` with before/after), which feeds the undo stack, autosave, dirty tracking, the MCP
live link and a future CRDT bridge. `alien-signals` provides per-record signals and memoized
queries. Editor UI state stays in Zustand, outside the document.

### Consequences

- Good, because the diff is the universal currency: undo is an inverse diff, autosave journals
  diffs, and a CRDT adapter maps diffs to `Y.Map`/`LoroMap` operations later.
- Good, because the store is framework-free, tiny, and identical in Node, workers and the browser.
- Good, because commands (03 §2) on top of transactions give AI, MCP and UI one mutation API.
- Bad, because we own indexes, query memoization and transaction merging (gesture coalescing).
- Bad, because collaboration is deferred; the CRDT bridge must be built and tested later.

### Confirmation

Property test: random command sequences followed by full undo restore the document exactly
(NFR-REL-003). Architecture test: every command emits record diffs only (NFR-MNT-006). A benchmark
enforces NFR-PERF-006.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| Tree + Immer | familiar | nested paths make CRDT mapping and per-record reactivity hard |
| MobX | fine-grained | proxies, implicit tracking, heavier, harder to serialize diffs |
| Jotai | fine-grained | React-bound; weak story for headless and transactions |
| CRDT first | collaboration now | cost and complexity before we need it; CRDT undo semantics leak into everything |
| Own store + signals | small, pure, diff-centric, CRDT-ready | we maintain it |

## More Information

Research: `docs/research/01-rendering-and-editor-engines.md` §3.1–3.3,
`docs/research/04-file-format-ai-generation-theming.md` §A.5. Architecture: `../02-document-model.md`,
`../03-core-engine.md`.
