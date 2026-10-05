---
'@fluxion/player': minor
'@fluxion/player-inline': patch
---

The deck draws chrome when asked (`chrome`, FR-PRS-006): a progress bar, a screen counter and a controls bar (previous, next, overview, full screen) that hides itself after three seconds without a pointer move or key and returns on the next. Each part has a `part` name for `::part()` styling and a CSS variable for its colours; the names of the controls are replaceable (`labels`). The one-file player turns it on.
