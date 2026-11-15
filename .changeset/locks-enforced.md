---
'@fluxion/core': minor
'@fluxion/editor': minor
---

Editing locks are enforced (FR-SHP-008). A position-locked element stays put through a drag, an arrow nudge and align (distribute leaves it out and spaces the others); a rotation lock keeps its turn and a size lock its size; an aspect lock keeps the ratio through a resize and `element.matchSize`, which skips a size-locked element; `element.pasteStyle` skips an edit-locked one; a selection lock keeps a click, a marquee and select-all on the canvas from picking it. Core exports `hasLock` and `lockedWithin`.
