---
"@fluxion/core": minor
"@fluxion/render": minor
"@fluxion/editor": minor
"@fluxion/pack-infographic": minor
"@fluxion/studio": patch
---

Text regions and icon slots (FR-SHP-007). A shape draws each text region after its first from `texts[region]` and each icon slot from `icons[slot]` (another definition's outline in the text colour, or an image). A double-click on a region edits that region alone; the inspector fills a slot with a shape definition; the Problems tab reports a `texts` entry naming the first region, which is never drawn, and removes it. Core adds `namedBoxes`; `labelBox` takes a region; `problemsOf` takes the shape definitions. The infographic pack adds a Feature card (three regions and an icon slot), which makes it pack format 1.3. The studio refuses a first-party definition bound to artwork fonts before reading any of its files.
