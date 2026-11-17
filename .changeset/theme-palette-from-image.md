---
"@fluxion/theme": minor
---

Palette from an image (FR-THM-005, ADR-0055). `paletteFromPixels({ width, height, data }, { seed? })` returns 1–3 seed colours for `generatePalette` from decoded RGBA pixels: a box-average downscale to 64 px, pixels under alpha 128 dropped, k-means (k = 5) in OKLab from a seeded k-means++ start, and the clusters with the most weighted chroma taken at least 30° apart in hue. A grey or transparent image gives the light theme's `primary`. Decoding stays with the caller; bad input is `PALETTE_INPUT`.
