---
"@fluxion/core": minor
"@fluxion/render": minor
"@fluxion/player": minor
---

Hosts check saved packs before loading any artwork font (ADR-0192). Core adds `checkVersionedShapePackSubsets`, the effect-free parse, rights and namespace check; render's `registerSavedShapePacks` runs it first, so a refused pack loads no face, and `loadFontFaces` skips families in the reserved `fx-artwork-` namespace. The player re-exports `registerSavedShapePacks` and `SavedShapePackPorts` for hosts. Migration: none; a `loadFontFaces` caller that named a face `fx-artwork-…` no longer gets it loaded.
