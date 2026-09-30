---
'@fluxion/render': minor
---

`<ScreenView>` draws through a camera as well as fitted (the editor canvas; `cameraTransform`). Groups and frames have built-in views (`GroupView`, `FrameView`: a frame draws its box and clips its members). A move re-renders only an element's wrapper, not its view (`sameButPlace`, ADR-0028 §4), so element views draw in their box's own coordinates.
