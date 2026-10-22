---
'@fluxion/layout': minor
'@fluxion/editor': minor
'@fluxion/cli': patch
---

`fit` (FR-LAY-012): the opt-in `fit` post-pass (`fitBoxes`, `safeAreaOf`) scales the unpinned boxes down together and moves them into the frame's safe area (inset by 5% of its smaller side by default); the `fit` layout runs it through `layout.arrange`, and the editor's "Fit content to screen" (screen menu and Arrange) runs it on the shown screen. The screen menu also offers "Tidy up".
