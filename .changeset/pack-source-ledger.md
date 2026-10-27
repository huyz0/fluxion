---
"@fluxion/sdk": minor
"@fluxion/pack-basic": minor
"@fluxion/pack-flowchart": minor
"@fluxion/pack-arrows": minor
"@fluxion/pack-callouts": minor
"@fluxion/pack-infographic": minor
---

Export each shape pack's declarative source (`basicSource`, `flowchartSource`, …) with names, credits and a version equal to the package version; `buildShapePackFiles` and `DeclarativeShapePack` move to, and `namedShapeDefs` joins, the `@fluxion/sdk` main entry. `@fluxion/sdk/testing` adds `checkShapePack` and `shapePackExpectation`, and packs ship `pack-versions.json` so changed geometry requires a new pack version (ADR-0194).
