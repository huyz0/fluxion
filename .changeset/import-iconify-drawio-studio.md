---
"@fluxion/editor": minor
"@fluxion/studio": minor
---

The library panel offers **Import Iconify…** and **Import draw.io…** beside **Import SVG…** when the host's `LibraryImporter` has the new `convertCollection`: one Iconify collection (credited from its own SPDX licence) or one draw.io library (under a declared pack identity and one credit) becomes a checked pack through `convertCollectionLibrary`, registers like an SVG pack, and the studio keeps its source for the save (M18.210). Migration: none; a host without `convertCollection` keeps only **Import SVG…**.
