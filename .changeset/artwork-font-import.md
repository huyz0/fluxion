---
"@fluxion/core": minor
"@fluxion/format": minor
"@fluxion/sdk": minor
---

Imported artwork keeps its exact fonts (ADR-0192). `encodeShapePack` takes an optional `fonts` draft (`ShapePackDraftFonts`) and then encodes a 1.1 pack with each verified font at `fonts/<sha256>.woff2`; `EncodedShapePack.index` is a `VersionedShapePackIndex`. `importedShapePack` and `iconifyShapePack` take `fonts` (`ImportedPackFont`) and give a 1.1 pack, with `fontFiles` and `source.fonts`, for entries whose text needs them, instead of refusing them. The sdk suite checks packs through `createArtworkShapePackLoader`: `checkShapePackFiles` takes an optional font map and returns a versioned index, `CheckedInShapePack.fonts` and `ShapePackExpectation.fonts` hold a 1.1 pack's binary fonts, the version ledger records font hashes, and `renderShapeGolden` takes optional alias bindings. Migration: none for 1.0 packs; code reading `ImportedPack.index`, `EncodedShapePack.index` or `CheckedShapePack.index` narrows on `formatVersion` for 1.1 fields.
