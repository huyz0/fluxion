---
'@fluxion/layout': minor
---

New `constraints` post-pass (`LayoutInput.constraints`: `align`, `sameRank`, `order`, `spacing`), run after `pins` and before `overlap`; the overlap pass no longer moves a node along an axis it is aligned on.
