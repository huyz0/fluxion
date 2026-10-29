---
"@fluxion/editor": minor
"@fluxion/format": minor
---

The editor imports SVG libraries (M18.175, ADR-0206): `convertSvgLibrary(input, options)` turns picked SVG files or one ZIP into one checked shape pack under declared rights (a credits file with inline notices, or one original or upstream credit), registering nothing, with the batch's literal colors (`svgBatchColors`, at most 64 plus an omitted count) for mapping to theme tokens; `registerSvgLibrary(registries, pack, ports)` registers the final pack and its exact fonts atomically under a namespace nothing holds. Bounds are checked from listed sizes before any bytes are read, and rights and the content license policy before any witness starts. Format adds `shapePackSubsetOf(source, policy)`, the saved subset of a pack source. Migration: none.
