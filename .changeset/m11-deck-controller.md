---
'@fluxion/player': minor
---

The deck is driven by a `PresentationController` over the presentation order and each screen's build groups (FR-PRS-002, FR-PRS-003): the arrow, page, space, enter and backspace keys, Home and End, a click, and a typed screen number plus Enter move it; a screen with build groups takes a press for each, with the elements a group hides left out. `deckAction`, `NumberEntry`, `buildsOfScreen` and `realtimeClock` are exported; the package now depends on `@fluxion/anim`.
