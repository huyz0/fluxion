---
'@fluxion/core': minor
'@fluxion/format': patch
'@fluxion/editor': patch
'@fluxion/cli': patch
---

Shape-pack format 1.3 (ADR-0054): a shape definition may declare `iconSlots` (named boxes as fractions, like `textRegions`), which only a 1.3 pack, category or saved subset holds; earlier envelopes refuse them. The encoder writes 1.3 only for a pack with an icon slot, and a saved subset that uses none is written as 1.2. New `hasIconSlots` and `hasCategoryNames`; `isFontFormat` and `packHasFonts` admit 1.3. My shapes now keep the font bytes of any font-bearing subset (1.2 and 1.3 as well as 1.1). The CLI's `pack import` reply may name format 1.3.
