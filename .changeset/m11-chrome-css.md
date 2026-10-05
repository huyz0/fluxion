---
'@fluxion/player': patch
---

The chrome's styles are a stylesheet (adopted by the element's shadow root, once in a page's head), so a page's `::part(controls)` and `::part(progress-fill)` rules win over them; a chrome button lets go of focus only after a pointer click, not a key press (FR-PRS-006).
