---
'@fluxion/routing': minor
'@fluxion/render': minor
'@fluxion/editor': minor
'@fluxion/studio': patch
---

Global routing pass on drop (FR-RTE-003, ADR-0044 amendment). `@fluxion/routing` gains `globalRoutes` and `globalRouteInput`. They route a screen's orthogonal connectors as one batch, around the shapes: one grid, A* that pays to cross routes already placed, simplify and nudge. They also add `RouteContext.refined`, routes drawn instead of the router's while they are set. `@fluxion/editor` gains `createGlobalRouting`, which runs the pass through a port once the document settles and sets the routes only while no change that moves a route has committed since. Its hit index follows the routes too. `@fluxion/render` passes `refined` through its registries and marks each connector's SVG with `data-route-pass`. The studio runs the pass in a routing worker.
