---
"@fluxion/cli": minor
"@fluxion/schema": minor
"@fluxion/format": minor
---

`fluxion render --format svg [--fonts outline|embed]` writes one standalone SVG per screen (`<dir>/<screen-id>.svg`), text outlined by default or embedded as used-glyph subsets; export findings come back as `FLX_EXPORT_*` diagnostics, now registered in `@fluxion/schema`. `@fluxion/format` exports `fontAssetFace`.
