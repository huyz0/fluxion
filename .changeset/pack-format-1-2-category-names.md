---
"@fluxion/core": minor
"@fluxion/format": minor
"@fluxion/cli": minor
"@fluxion/sdk": patch
"@fluxion/player": patch
"@fluxion/studio": patch
---

Shape pack format 1.2 keeps category display names (ADR-0210, M18.211): an index category entry may carry `name` and a saved subset `categoryNames`, and the encoder writes them only for a category text that is neither its slug nor that slug's `categoryTitle`, so every other pack keeps its 1.0 or 1.1 bytes. 1.2 is 1.1 plus names: core's new `packHasFonts`/`isFontFormat` answer "1.1 or 1.2" for every font-bearing reader, a 1.2 embed saves under `packFormat: '1.2'` with its fonts checked at the lock, and `fluxion pack-import --json` may reply `formatVersion: '1.2'`. Core also exports `categoryTitle`, `categoryNameProblem` and `CATEGORY_NAME_MAX`. Migration: none; 1.0 and 1.1 files read unchanged, and a name in them is refused.
