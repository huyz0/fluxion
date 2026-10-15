---
'@fluxion/layout': minor
'@fluxion/dsl': minor
---

M13.17, `layered` in FluxScript (FR-LAY-001, FR-DSL-005): `registerBuiltInLayouts` also registers `layered`. The place stage lays out a screen or group without a `layout:` with `layered` (it was `stack`), gives the layout the document's bound connectors as edges, and runs it through the layout pipeline (pins, overlap removal, 0.5 px snap). `FLX_DSL_NOT_YET` for `layered` now only appears on a host that does not register it.
