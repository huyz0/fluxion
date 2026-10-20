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

## Amendments

- **Amendment 2026-10-20 (M16.15, M16.16).**
  - **The cheap pass is the synchronous pass.** `routeConnector` asks routers for `cheap` unless told otherwise. That way the connector view, the editor's hit index, the outline and the handles all draw one route. Nudge and label placement are not part of that pass, so a drag pays for neither.
  - **The global pass result is not a transaction.** It is a derived overlay (`RouteContext.refined`, a signal of routes by connector id), as in 05 §4 "two-phase UX". It is not written to the document. So it adds no undo step, changes no file and needs no schema change.
  - **Ownership.** The editor's `createGlobalRouting` owns the overlay:
    - It clears it on any commit that could move a route (below).
    - It runs the pass once the document has been unchanged for `GLOBAL_ROUTE_SETTLE_MS` (a drop, or any settled edit).
    - It sets the routes only if no change that could move a route committed since the job was asked: the revision compared is that of what routes depend on (element boxes, kinds, shape definitions and anchors, connector routes, ends and bindings, any record created or deleted). A job that such a change overtakes is cancelled, and its late answer is dropped; the routes are cleared at once and asked again once the document settles.
    - A change to a field that moves no route (name, style, text, labels, markers, locks) neither clears the routes nor drops an answer, so editing text does not make every route flicker back to the cheap pass.
  - **Where the pass runs.** The studio runs it in its routing worker (`route.worker.ts`, `createRoutePort`), not through the layout host.
    - The layout host's message protocol is layout-specific.
    - The routing job needs only a run, a cancel by terminating the worker, and an id check.
  - **Studio dependency.** The studio may import `@fluxion/routing`, as it imports `@fluxion/layout` for its layout worker. Without that, the worker module would have to reach `globalRoutes` through the editor and bundle all of it.
  - **Scope of the pass.** It routes orthogonal connectors without waypoints, because waypoints are the author's constraints. It uses one grid with the end points and stub tips on it, A* that pays to cross routes already placed, simplify, and one nudge. Label placement stays out of this pass, because a label's position is the author's fraction.
  - **A refined route is drawn only while it joins the current ends.** `routeConnector` uses it only if it starts at the source point and ends at the target point it resolves now. An end that has moved without a commit (one on a host connector whose own route was refined, say) gets the router's route rather than a detached one. A shape definition or router registered, replaced or disposed also clears the routes and asks again, like a commit that moves a route.
  - **A connector the bounded search gives up on keeps its cheap route.**
- **Amendment 2026-10-20 (M16.29 containment).**
  - **The overlay broke parity.** Present mode and the `.flux.html` player draw the cheap routes. Drawing the global routes in edit broke edit/present parity (FR-EDT-010, a Must) and studio/file fidelity (FR-FIL-001). CI caught both on the shapes gallery.
  - **The studio draws the overlay only when asked.** It does so only on `?routing=global`, and never by default. The pass, its worker and the overlay stay as above.
  - **Open decision (M16.28).** Every renderer must draw the same routes. Two ways to get there: persist the global result in the document (this ADR's first decision, a schema change), or have the player run the same pure pass.
- **Amendment 2026-10-20 (M16.28 — every renderer runs the pure pass; the one-file player loads it lazily).**
  - **Decision.** The open decision above is closed in favour of running the pass, not persisting it. The document is unchanged: no schema change, no migration, and a file saved by an older studio draws the same routes.
  - **Render owns "settled routes".** `RenderRegistries.globalPass` is a signal holding a `GlobalPass` (the pure `globalRoutes`), or undefined while none has arrived. `withSettledRoutes(store, registries)` turns it into the `refined` overlay: one store query per screen, built from the cheap pass's ends, as the worker builds its input. Routes equal to the last ones keep their identity, so a view re-renders only when its route moved. Registries that already carry `refined` (the studio's worker overlay) or no pass at all are returned as they are. Render never imports `globalRoutes`, so nothing that bundles render carries the pass by accident.
  - **Who hands in the pass.**
    - The studio always draws its worker overlay. `?routing=global` is gone.
    - The CLI's render and the exporters hand `globalRoutes` in directly.
    - The one-file player does not: it routes in a worker (below) and hands in the routes as `refined`, as the studio does.
  - **The routing chunk.** The pass is about as big as the player's headroom under `PLAYER_CORE_GZIP` (150 kB, NFR-SIZE-001), so it is not in the player bundle.
    - `@fluxion/player-inline` builds it as its own classic script, `fluxion-routing.js`. On a page it defines `FluxionRouting.globalRoutes`; in a worker it answers each `{ id, input }` with `{ id, routes }`.
    - The `.flux.html` writer embeds it as an inert `<script type="text/plain" id="fluxion-routing" data-fluxion-chunk="routing">` block before the player, escaped as the player is.
    - The player runs it as a worker from a Blob URL. The file's CSP has no `worker-src`, so `script-src`, which allows `blob:`, governs workers, and the CSP keeps its two hashes. The chunk is part of the same file and was hashed by nothing outside it, so a separate integrity check would add nothing (unlike plugin bundles, §7 of 08).
    - The `<fluxion-player>` element reads `fluxion-routing.js` from beside its own script and runs it from a Blob URL the same way. A worker script must be same-origin with the page; the element script need not be.
  - **The pass never runs on the player's main thread.** It takes hundreds of milliseconds on a busy screen (about 350 ms for the 200 connectors of `perf-route-200`). Running it in the page would break performance.md rule 9 and this ADR's 50 ms bound.
    - The player builds each screen's input on the main thread from the cheap routes, as the editor does: the store is read-only, so it is built once.
    - It posts the screens one at a time and draws each screen's routes as they arrive.
    - It starts only once the views have drawn the cheap routes and the frame is painted.
    - `e2e/perf.player-route-settle-200.spec.ts` checks that a `.flux.html` of `perf-route-200` settles with no main-thread task over 50 ms after the first paint.
  - **Two-phase drawing.** The player draws the cheap routes at once, then the settled ones as the worker answers. The mount root says which: `data-routes` is `pending`, then `settled`, or `cheap` when there is no chunk or its worker failed. With no chunk (an older file, or a writer that omits it) the player draws the cheap routes, as before.
  - **Tests and gates wait for `settled`.** The studio's and the file's roots both carry `data-routes`. Parity (FR-EDT-010) and fidelity (FR-FIL-001) checks wait for `settled` before they compare.
