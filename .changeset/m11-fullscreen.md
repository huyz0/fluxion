---
'@fluxion/player': minor
---

Full screen (FR-PRS-001): the F key puts the deck in fullscreen through the Fullscreen API (the WebKit-prefixed form where only that exists, and nothing on iPhone Safari, where the deck already fills the viewport), `toggleFullscreen` is exported, and `PlayerDeck` and `PlayerRoot` take a `background` colour for the bars around a screen.
