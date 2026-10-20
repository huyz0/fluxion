---
'@fluxion/render': minor
'@fluxion/format': minor
'@fluxion/player-inline': minor
'@fluxion/cli': minor
'@fluxion/editor': patch
---

Every renderer draws the global routing pass's routes once the document is still (ADR-0044 amendment M16.28):
- `RenderRegistries.globalPass` and `withSettledRoutes` let a host hand in the pure pass.
- The `.flux.html` writer takes an optional `routingScript`, which it embeds as an inert `#fluxion-routing` block.
- The one-file player runs that block lazily as a worker, so the pass never blocks the page. The element reads `fluxion-routing.js` from beside its script. The player marks its root `data-routes` `pending`, `settled` or `cheap`.
- The CLI's render runs the pass.
- The editor root carries `data-routes` too.
