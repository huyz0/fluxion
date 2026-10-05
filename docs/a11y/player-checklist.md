# Player accessibility checklist

What a change to the player (the deck, its chrome, the views it draws) keeps true (NFR-A11Y-002, NFR-A11Y-004). Each line names how it is checked; a line with no check is
a manual step for the person reviewing the change.

## Automated

- **No serious or critical axe finding** on the player as it opens, after moves, with the overview grid open, and on the editor. `e2e/a11y.player.spec.ts` (Chromium,
  Firefox and WebKit on the desktop projects).
- **Screen changes are announced**: a `role="status"` live region reads "Screen N of M: name" after every move, and the screen's name is a heading. `e2e/a11y.player.spec.ts`
  (the live-region text on navigation).
- **What a screen draws without words has words**: an image with a label has that label as alt text, and a connector reads "A connects to B: label" from the elements it
  joins (a free end says so). A view supplies them through `ElementView.a11y` (ADR-0015, amendment M11.16); `packages/render/src/a11y.test.ts`.
- **Text keeps its structure**: headings, paragraphs and (nested) lists are `h1`–`h6`, `p`, `ul`/`ol` and `li` in the DOM, not drawn lines (`packages/render/src/rich-text.test.tsx`).
- **Keyboard**: every move, the overview and full screen work without a pointer (`e2e/player.keyboard-nav.spec.ts`; the whole presentation without one is M11.17).

## Manual (before a release)

- **VoiceOver (Safari, macOS/iOS) and NVDA (Firefox, Windows)**: open `examples/r1-mvp-deck.flux.html` once it exists, move through three screens with the arrow keys, and check that
  each move is spoken once, as "Screen N of M" with the name, and that a connector is read as a relation. Record the date and the versions in the pull request.
- **Contrast**: the chrome's text on its background is at least 4.5:1 (axe's `color-contrast` runs in the spec above; a page that restyles `::part()` owns its colours).
