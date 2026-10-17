---
status: accepted
date: 2026-10-17
decision-makers: harness (M16.2; within FR-CON-004, FR-RTE-003, FR-RTE-004 and NFR-PERF-005; no requirement changes)
---

# ADR-0042 — Orthogonal router: our own A* on a sparse non-uniform grid, with nudge and simplify post-passes

## Context and Problem Statement

M5 shipped an elbow router that handles an empty canvas. FR-CON-004 asks for obstacle avoidance with few bends, FR-RTE-003 for connectors that share a channel to be spread apart, FR-RTE-004 for byte-identical output for the same input, and NFR-PERF-005 for 200 orthogonal routes in under 300 ms. The router must live in a pure package (no DOM, clock or randomness) and run in a worker.

## Decision Drivers

- Routes must look hand-drawn: few bends, constant clearance, no jogs.
- Determinism: the same document gives the same bytes on every machine, so ties are broken by a fixed order, never by hash order or floating-point accident.
- Budget: 200 routes under 300 ms on the CI reference runner.
- Licensing: the player and library packages stay permissive; an LGPL router cannot be linked in.

## Considered Options

1. **libavoid (WASM).** Best-in-class quality, but LGPL, a WASM payload and a second source of nondeterminism.
2. **A uniform grid with A*.** Simple, but the cost grows with canvas area and routes hug grid lines rather than obstacles.
3. **A sparse non-uniform grid with A*, then nudge and simplify (chosen).** Grid lines only where they matter, so the node count follows the number of obstacles rather than the canvas size.

## Decision Outcome

Option 3, in `packages/routing/src/orthogonal/`.

**Grid.** Lines at every obstacle edge plus and minus a margin, at each anchor stub, and at midlines between neighbouring obstacles. One grid is built per batch of connectors from the shared spatial index and reused by every route in the batch.

**Search.** A* over grid intersections with cost `length + bend·B + crossing·C`. `B` and `C` and the margin are router options with defaults. The heuristic is the Manhattan distance plus the minimum bends still owed. The open set is ordered by cost, then by a fixed intersection order, so ties resolve the same way everywhere. The search window is bounded; a route that does not fit falls back to the M5 elbow rather than failing.

**Post-passes.** `nudge` orders collinear overlapping segments per channel by their next turn and spreads them by `spacing`, staying inside the channel bounds; it re-checks the result against the obstacles and returns the un-nudged route if a segment would enter one. `simplify` drops collinear points, merges jogs under 4 px and keeps a minimum end stub. Both are pure functions on a path.

**libavoid.** It stays an optional later pack (`routing-libavoid`), behind the router registry (M16.3), because of its LGPL boundary. No M requirement needs it.

### Consequences

- Good: no new dependency, pure and deterministic, fast on sparse screens.
- Good: obstacle avoidance, nudging and simplification are separate, testable functions with property tests.
- Bad: we own the router's quality. The property tests (axis-aligned, never inside an inflated obstacle, spacing after nudge) and the 200-route bench are the guard.
- Bad: very dense screens may exceed the search window and fall back to the elbow; the worker pass (ADR-0044) is the escape.

### Confirmation

M16.5 (grid goldens), M16.6 (`orthogonal.prop.test.ts`), M16.7 (nudge and simplify properties), M16.14 (determinism), M16.19 (`route-200.bench.ts` against `ROUTE_200_ORTHO_MS`).

## More Information

ADR-0005 (layout and routing stack), 05-layout-and-routing.md §3 and §8, FR-CON-004, FR-RTE-003, FR-RTE-004, NFR-PERF-005.
