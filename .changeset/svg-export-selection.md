---
'@fluxion/render': minor
'@fluxion/exporters': minor
---

SVG export of a selection: `exportSvg(file, { selection })` draws the selected elements and their members, connectors whose two ends are drawn, no master or background, in a viewBox of their world bounds widened by stroke, shadows and effects and rounded out to whole px; its package holds the selection alone (`scope="selection"`). `@fluxion/render/svg` exports `selectionScope` and `selectionViewBox`, and `ScreenSvgView` takes `selection`. The SVG 1.1 checker now allows an outside link only as an `<a>`'s own web or mail address.
