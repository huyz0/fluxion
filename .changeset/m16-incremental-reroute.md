---
'@fluxion/routing': minor
'@fluxion/render': patch
'@fluxion/editor': patch
'@fluxion/core': patch
---

Dragging a shape with 200 connectors holds 50 fps (FR-RTE-002, ADR-0044). A move reroutes only the connectors bound to what moved. `@fluxion/routing` gains `affectedConnectors` and `rerouteAffected` (the connectors a move touches, by the bindings index, for passes outside the renderer's queries), and a `RouteQuality` passed to routers (`cheap`, `routeConnector`'s default, for the synchronous pass every view, hit test and handle shares: no nudge, no labels; `full` for the global pass on drop). The connector view memoises its style and keeps its SVG box while the route fits it; the editor's hit index reroutes a connector only when a query needs it; `projectToOutline` runs its nearest-point search once.
