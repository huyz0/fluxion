---
title: Presenting
description: Present a deck from the studio or from a .flux.html, move with the keyboard, a click or a swipe, share a link to a screen, and put a deck in your own page.
---

A Fluxion deck can be presented in three places: in the studio, from a `.flux.html` you double-click, and inside a page of your own. The keys that move
through the deck are the same in all three; the rest (the controls, touch, the overview, full screen and links) belong to the player in a `.flux.html` and
in a page, and each section below says where it applies. The studio presents in place, to check a deck as you edit it.

## Present from the studio

Press **F5** (or use the Present button) to present from the first visible screen, and **Esc** to come back to editing on the screen you were on.
**Shift+F5** switches between editing and presenting. Hidden screens are skipped; build groups of a screen play before the next screen. In the studio the keys
below that move through the deck work (the arrows, Page Up and Down, Space, Enter, Backspace, Home, End and a typed screen number), and Esc leaves; the
controls, full screen, the overview, clicks and touch, and links are the player's, in a `.flux.html` or a page.

## Present from a file

A **`.flux.html`** presents in any browser, offline: it asks the network for nothing. Open it and the first screen fills the window.
A `.flux` opens in the studio, which presents it as above.

## Move through the deck

In the studio, in a `.flux.html` and in a page (a click, **F**, **O** and Esc closing the overview belong to the player; in the studio Esc leaves presenting):

| To | Press |
|---|---|
| Go forward (a build group, then the next screen) | Right, Down, Page Down, Space or Enter, or click |
| Go back | Left, Up, Page Up or Backspace |
| First or last screen | Home or End |
| Go to a screen by number | type its number (up to four digits), then Enter; Backspace erases a digit and Esc drops the number |
| Full screen | **F** |
| Overview of all screens | **O** (Esc or **O** closes it) |

The keys are left alone while a link, a button or a field has focus, and a held key does not repeat the move.

## On a phone or tablet

In a `.flux.html` or a page:

- **Swipe** left for the next screen and right for the previous one.
- **Tap** the screen to step forward.
- **Pinch** to zoom into a screen (up to four times) and drag to pan; the screen always covers the window.
  While you are zoomed in, a swipe pans instead of moving, and a tap does not step.
- **Double-tap** a zoomed screen to fit it again.
- Turning the device, or resizing the window, keeps the screen and the build group you were on, and fits the screen to the new size.

## The controls

In a `.flux.html`, and in a page with the `controls` attribute, a progress bar runs along the bottom, with a counter ("3 / 20") and a bar of controls: previous, next, overview and full screen. The controls hide after a few
seconds without a pointer move or a key, and come back on the next move. The overview shows every visible screen as a small picture; pick one with the pointer or
the arrow keys and Enter.

## Share a link to a screen

In a `.flux.html` the address holds where you are, as `#/<screen id>/<step>`: the screen's id (it is made for you; copy the address rather than writing one) and the number of build
groups played. Copy it and whoever opens it lands on the same screen; the browser's back button returns to the previous screen, and a reload stays where it was. An embedded
`<fluxion-player>` leaves your page's address alone: it reports where it is through the `fluxion-position` event, and `goTo` takes you to a screen.

## Everyone can present

In a `.flux.html` or a page:

- A screen reader hears each screen's name as a heading and, after every move, "Screen 3 of 20: Security".
- Shapes joined by connectors are read as "Client connects to Gateway", with the connector's label; an image with a label has it as its alternative text.
- The whole presentation works without a pointer: the keys move, **Tab** reaches the controls, and the overview keeps focus inside while it is open and gives it back when it closes.

## Put a deck in your own page

Include the standalone script and use the element:

```html
<script src="fluxion-player.js"></script>
<fluxion-player src="deck.flux" controls start="2" style="width: 100%; aspect-ratio: 16 / 9"></fluxion-player>
```

- `src` is a `.flux` (fetched without cookies or a referrer); `controls` draws the progress bar and the controls; `start` is the screen to open at, a number or an id.
- The element draws in a shadow root and leaves your page alone; its keys work while it has focus. Style the parts from your page with `::part()`
  (`controls`, `progress-fill`, `counter`, `message`, …) and with the variables `--fx-player-chrome-color`, `--fx-player-chrome-background`,
  `--fx-player-progress-fill` and `--fx-player-progress-track`.
- Methods and events: `next()`, `prev()`, `goTo(screen, group)` and `position`; the events `fluxion-load`, `fluxion-position` and `fluxion-error`.
- In React, use `FluxionPlayer` from `@fluxion/player/react` with the props `src` or `bytes`, `position`, `onPosition`, `controls` and `start`.

`examples/embed/index.html` in the repository is a working page.
