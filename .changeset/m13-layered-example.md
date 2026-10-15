---
'@fluxion/dsl': patch
---

M13.21, the layered example (FR-LAY-002, FR-LAY-008): `examples/dsl/layered-flow.flux.yaml` has no `layout:`, so the screen is laid out by `layered`; the example runner compiles it, round-trips it and compares its drawing with the golden SVG.
