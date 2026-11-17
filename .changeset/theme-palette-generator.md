---
"@fluxion/theme": minor
---

Palette generator (FR-THM-005, ADR-0055). `generatePalette({ seeds, locks?, shuffle? })` builds the 17 colour roles from 1–3 seed colours in OKLCH, repairs each role's lightness until every text pair is at least 4.5:1 and every graphic pair 3:1 on the emitted hex, keeps locked roles verbatim (every unlocked partner is solved against a lock; with any lock the palette is solved with light and inverted neutrals and the one with fewer misses, then less movement, is kept, and the fills are kept 0.02 apart in OKLab where their band allows) and permutes the unlocked hue slots by a seeded shuffle; bad input is the new error code `PALETTE_INPUT`. `applyPalette` writes a palette into a theme's role tokens. Also exports `CONTRAST_TEXT`, `CONTRAST_GRAPHIC` and the pair table `PALETTE_CONTRAST_PAIRS`.
