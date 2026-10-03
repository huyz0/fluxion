---
'@fluxion/pack-fonts-core': minor
'@fluxion/render': minor
'@fluxion/sdk': minor
'@fluxion/editor': minor
'@fluxion/studio': minor
---

The bundled fonts have recorded metrics (`FONT_METRICS`, `record-metrics.mjs --bundled`); the page's shared measurer measures a font with recorded metrics from them and any other with the canvas (`registerFontMetrics`, `browserMeasurer`); the studio registers them once the faces have loaded (FR-THM-008, ADR-0148).
