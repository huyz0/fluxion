---
"@fluxion/exporters": minor
"@fluxion/render": minor
"@fluxion/core": minor
"@fluxion/format": minor
"@fluxion/sdk": minor
---

SVG export outlines text by default (ADR-0056 item 5): `exportSvg` takes `ports.fonts` (the host's faces and the pinned WOFF2 codec) and draws each piece as its glyphs' path, shaped by fontkit, with its marks and the label's text in a `<title>`; a font with no face stays `<text>`, reported `FLX_EXPORT_FONT_NOT_EMBEDDED`. `useExportText` pieces carry their marks and outline. core exports `matchFace`; format exports `fontSfnt`.
