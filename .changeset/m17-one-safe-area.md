---
'@fluxion/layout': minor
'@fluxion/editor': patch
---

`screenFrame` is exported from `@fluxion/layout`; the editor's Fit notice judges against the layout's own `safeAreaOf` over it, the area the fit uses.
