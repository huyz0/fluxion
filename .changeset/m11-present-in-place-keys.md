---
'@fluxion/player': minor
'@fluxion/editor': minor
---

Present in place moves with the deck's keys (FR-PRS-002, FR-PRS-003): the arrows, page keys, space, Enter, Backspace, Home, End and a typed screen number plus Enter drive a `PresentationController` over the visible screens and each screen's build groups, hidden screens are skipped, the elements a group hides are left out, and Esc returns to the screen last shown. `@fluxion/player` exports `hiddenAt`.
