---
'@fluxion/schema': minor
'@fluxion/routing': minor
'@fluxion/editor': minor
'@fluxion/format': patch
---

Curve tangents and the jump style (ADR-0168, FR-CON-007): a connector's `route` takes `tangents` (the control point of a route point of a `curved` route) and `jumps` (`arc`, `gap` or `none`), and schema 1.5 with a `1.4 → 1.5` migration. The curved router uses the tangents, a selected curved connector shows a handle for each, and the lean reader also opens 1.4.
