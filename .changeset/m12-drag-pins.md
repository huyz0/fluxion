---
'@fluxion/core': patch
'@fluxion/editor': patch
'@fluxion/render': patch
---

A hand placing an element pins it (ADR-0031, FR-EDT-022): the select tool's drag, resize and rotate, the arrow-key nudge, and align and distribute set `placement: 'pinned'` on the boxes they move, in the same undo step, so the Source view shows a `pin:` for them. Esc during a drag or resize puts the placement back too. A move that pins an element does not draw its view again. The Source view now looks at a canvas change once the canvas has been quiet for 50 ms (a drag is one regenerated text, not one every 50 ms).
