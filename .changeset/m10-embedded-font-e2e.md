---
'@fluxion/studio': patch
---

A `.flux.html` made from a saved copy with an uploaded font is checked end to end: opened from `file://` it fetches nothing, loads the font from its own bytes and draws the studio's pixels (FR-THM-008).
