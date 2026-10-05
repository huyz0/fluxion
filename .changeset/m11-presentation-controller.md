---
'@fluxion/player': minor
---

`PresentationController` holds where a presentation is (a screen and how many of its build groups have played) and moves it: `next` and `prev` play a screen's groups before leaving it, `first`, `last` and `goTo` jump, `back` returns through the history, and a hidden screen the source leaves out is never visited (FR-PRS-002, FR-SCR-002). Pure, over a `DeckSource` and a `Clock`.
