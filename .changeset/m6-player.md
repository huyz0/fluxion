---
'@fluxion/player': minor
---

The present-mode root (M6): `PlayerRoot` presents a document's first visible screen fitted into the window, drawn by the same `<ScreenView>` as the editor; `renderRegistriesFor` builds render registries from a core's, and `useElementBox` (with `Box`) follows an element's size. `LaserTrail` draws the presenter's laser over a screen, each dot fading from when it appears (`LASER_FADE`, `trailKeys`, `LaserPoint`, `TrailDot`). The package now depends on React (`react`, `react-dom`) and on `@fluxion/core`, `@fluxion/render` and `@fluxion/schema`.
