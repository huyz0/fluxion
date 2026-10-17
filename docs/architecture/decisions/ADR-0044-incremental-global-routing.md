---
status: accepted
date: 2026-10-17
decision-makers: harness (M16.2; within FR-RTE-002, FR-RTE-003 and NFR-PERF-002; no requirement changes)
---

# ADR-0044 — Incremental and global routing: a bindings index, a cheap pass per frame, a worker pass on drop

## Context and Problem Statement

FR-RTE-002 asks that dragging a shape with 200 connectors holds 50 fps and reroutes only the connectors it affects. FR-RTE-003 asks for polish (nudging, labels) that a per-frame budget cannot afford. NFR-PERF-002 asks a 2k-element, 1k-connector screen to stay fluid.

## Decision Drivers

- A frame is 16 ms; the full pipeline is too slow for 200 connectors.
- The main thread must never block for more than 50 ms.
- A result that arrives after the document moved on must never be applied.

## Considered Options

1. **Reroute everything every frame.** Misses the budget.
2. **Reroute everything in the worker, always.** The connector lags the shape during the drag.
3. **A cheap synchronous pass for affected connectors during drag, and a global pass in the worker on drop (chosen).**

## Decision Outcome

Option 3.

**Bindings index.** A map from element id to the connectors bound to it (and from a connector to connectors attached to it, FR-CON-009), maintained from the store's patches. A move of element E reroutes the connectors in the index for E and, transitively, those attached to them.

**Per-frame pass.** The affected connectors are routed with the cheap pipeline: grid, A*, simplify; no nudge and no label placement. Auto anchors are frozen (ADR-0043).

**Global pass on drop.** The worker routes the whole screen with nudge, labels and re-scored anchors. Each request carries the document revision; the result is applied in one transaction only if the revision is unchanged, otherwise it is dropped and a newer request is made. This reuses the layout worker's cancellation and progress contract.

**Route cache.** A route is cached by the fingerprint of its inputs (endpoints, obstacles within the search window, options). A frame that moves nothing a route depends on reuses it.

**Large screens.** The renderer culls with a flatbush index and memoizes connector views per route revision (M16.18).

### Consequences

- Good: the drag cost grows with the number of affected connectors, not the screen.
- Good: stale results cannot corrupt the document.
- Bad: the route can change slightly on drop (nudge, labels); the animation layer may morph it later (M22).
- Bad: the bindings index is state to keep in step with the store; a property test compares it with a full recomputation.

### Confirmation

M16.15 (`incremental.test.ts`, `perf.route-drag-200.spec.ts` against `ROUTE_DRAG_200_MIN_FPS`), M16.16 (stale result dropped, long tasks at or under 50 ms), M16.18 (`perf.big-screen.spec.ts`).

## More Information

ADR-0042, ADR-0043, 05-layout-and-routing.md §4 and §9, FR-RTE-002, FR-RTE-003, NFR-PERF-002.
