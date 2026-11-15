---
"@fluxion/geometry": minor
"@fluxion/core": minor
"@fluxion/render": minor
"@fluxion/routing": minor
"@fluxion/editor": minor
"@fluxion/format": patch
"@fluxion/cli": patch
"@fluxion/studio": patch
---

The path shape (ADR-0053, FR-SHP-010, FR-SHP-011). Every host's registries hold `core:path`, which draws the `path` its element owns (`d` in a `w × h` box scaled to the element, every subpath under `fillRule`), is hit and anchored on that outline, and keeps the rectangle's side anchors. A `path` on any other shape is ignored and the Problems tab reports it with a fix that removes it. Geometry adds `parsePathData` and `pointInPaths`; core adds `CORE_PATH_DEF`, `CORE_SHAPE_DEFS`, `CORE_SHAPE_IDS`, `ownPath` and `ownPathOf`; routing exports `AnchoredElement`. Saves never embed core shapes; the library does not list them.
