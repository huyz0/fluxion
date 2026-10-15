---
'@fluxion/layout': minor
---

M13.13, the layout pipeline (ADR-0033): `layoutSync(request)` validates the input, runs the algorithm with a seeded sfc32 stream (`createRng`), then the pins, overlap and snap passes, and returns the boxes with `metrics` and a 128-bit `fingerprint`; failures are a `LayoutError` result (`LAYOUT_INPUT_INVALID`, `LAYOUT_OPTIONS_INVALID`, `LAYOUT_FAILED`). `fingerprintOf` and `createLayoutCache` key results by fingerprint.
