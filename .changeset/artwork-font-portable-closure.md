---
"@fluxion/format": minor
---

Retain exact artwork fonts in portable saves (ADR-0192). Pack 1.1 sources save as 1.1 subsets with only the used font closure, under `packFormat: '1.1'` locks, and their verified bytes as `assets/<sha256>.woff2`; loaders rehash them and refuse missing or changed fonts. A save retaining fonts is checked against `destinationLimits`.

Migration (pre-1.0 widening): `LoadedFlux.shapePacks` is now `VersionedShapePackSubset[]`, `ShapePackSourceData` accepts 1.1 indexes and subsets plus optional `fonts`, `ShapePackDataLock.packFormat` is `'1.0' | '1.1'`, and `PreparedShapePacks` adds `fontAssets`. Code reading 1.0 subsets should check `formatVersion`; `registerShapePackSubsets` refuses 1.1 until hosts register exact faces.
