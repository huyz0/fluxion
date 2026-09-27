---
status: accepted
date: 2026-09-27
decision-makers: harness (M2.17; within NFR-REL-005, 03-core-engine §6, 04-rendering-and-editor §2.5)
---

# ADR-0141 — Spatial index: `rbush` and `flatbush` behind one `SpatialIndex` interface

## Context and Problem Statement

Culling, hit-testing, snapping and routing (04 §2.5, §3; 05) query "which elements touch this
box" many times per frame. 03 §6 names `rbush` for the editor (dynamic inserts and removals) and
`flatbush` for the player and export (built once, packed, faster queries). Both become runtime
dependencies of `@fluxion/geometry`, which the player bundles, so code-structure rule 1 needs an
ADR. Neither library promises an order for query results, and NFR-REL-005 needs one.

## Decision Drivers

- NFR-REL-005: the same queries give the same results in the same order, on every run and OS.
- Player size (NFR-PERF budgets): small, dependency-light libraries only.
- Pure core (non-negotiable 5): no DOM, timers or randomness.
- Licences allowed for shipped code (check-licenses).

## Considered Options

1. **`rbush` 4 (MIT, 1 dependency `quickselect`, ISC) and `flatbush` 4 (ISC, 1 dependency
   `flatqueue`, ISC)** behind a `SpatialIndex` interface whose results are sorted by id.
2. Our own grid or quadtree: no dependency, but a re-implementation of well-tested R-trees and
   worse on the skewed layouts diagrams produce.
3. `rbush` only: one dependency, but slower static queries and more memory in the player.

## Decision Outcome

Chosen option 1. `@fluxion/geometry` exports `SpatialIndex` (`search(box)`, `collides(box)`,
`size`) with two factories: `createDynamicIndex()` (rbush: `insert`, `remove`, `clear`) and
`createStaticIndex(items)` (flatbush, built once). Both return hits sorted by id (code-unit
order), so the adapters are interchangeable and NFR-REL-005 holds whatever the tree shape. Boxes
touching at an edge intersect in both. Both packages ship their own types, are pure ESM and
use no DOM, timers or randomness.

### Consequences

- Good: well-known, fast R-trees; the sort makes results deterministic and adapter-independent.
- Bad: two runtime dependencies (plus one small transitive each) in the player bundle, about
  6 kB minified together; sorting costs O(k log k) per query for k hits.
- Neutral: a later ADR can swap either adapter behind the same interface.

### Confirmation

`NFR-REL-005: both spatial index adapters return identical sorted hits` (property over random
boxes and queries, compared with a brute-force scan); check-licenses on the lockfile.
