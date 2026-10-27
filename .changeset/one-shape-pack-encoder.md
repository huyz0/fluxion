---
"@fluxion/core": minor
"@fluxion/sdk": minor
"@fluxion/format": minor
"@fluxion/pack-basic": patch
"@fluxion/pack-flowchart": patch
"@fluxion/pack-arrows": patch
"@fluxion/pack-callouts": patch
"@fluxion/pack-infographic": patch
"@fluxion/pack-uml": patch
---

One shape pack encoder (ADR-0196): core's `encodeShapePack` writes and validates every declarative pack, first-party and imported, so the same pack gives the same bytes. `buildShapePackFiles` now validates and returns a `Result`; `importedShapePack` and `iconifyShapePack` are synchronous and no longer take a `hasher`. First-party pack files are regenerated with sorted keys.
