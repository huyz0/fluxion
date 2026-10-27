---
"@fluxion/core": minor
---

Add strict pack 1.1 font metadata (ADR-0192): `parseVersionedShapePackIndex`, `parseVersionedShapePackCategory` and `parseVersionedShapePackSubset`, the 1.1 envelope and font binding types, `artworkFontProfiles` and `artworkFontLicenses`. The existing 1.0 parsers, schemas and types are unchanged. Migration: 1.0 packs need nothing; packs whose artwork draws text move to 1.1 and declare exact resources, faces, bindings and font credits.
