---
"@fluxion/core": minor
"@fluxion/render": minor
"@fluxion/player": minor
"@fluxion/player-inline": minor
---

Register retained artwork fonts under private aliases derived from their byte identity (ADR-0192). Core adds `artworkFontAlias`, `aliasSvgArtworkFonts`, `artworkFontRequirements` and `registerVersionedShapePackSubsets`; render adds `registerArtworkFonts`, `registerSavedShapePacks` and the optional `RenderRegistries.artworkFonts` (also a new optional parameter of `createRenderRegistries`, `builtinRegistries` and the player's `renderRegistriesFor`). The one-file player opens 1.1 packs with their exact fonts and refuses files whose bytes are missing. Migration: none for existing callers; `registerShapePackSubsets` still refuses 1.1.
