---
'@fluxion/player': minor
'@fluxion/render': minor
---

The `<fluxion-player>` element (FR-PRS-009): `@fluxion/player/element` has `defineFluxionPlayer(open, tag)`, which defines the element over a file-opening port. It draws into an open shadow root that adopts the content CSS, takes `src` (fetched without credentials or a referrer), `start` and `controls`, has `load`, `next`, `prev`, `goTo` and `position`, reports `fluxion-load`, `fluxion-position` and `fluxion-error`, and takes only its own keys. `PlayerDeck` gains `layout`, `scope` and `onController`; `@fluxion/render` exports `ContentCssContext`.
