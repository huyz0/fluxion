---
"@fluxion/exporters": minor
"@fluxion/render": minor
"@fluxion/sdk": minor
---

SVG export can embed fonts (`fonts: 'embed'`, ADR-0056 item 5): each face is cut to the export's codepoints by the host's font subset job and written once as an `@font-face` data URL under a private alias that the text names first; a refused subset embeds the whole file (`FLX_EXPORT_FONT_WHOLE`). The svg surface context gains `family`; `useExportText` fonts name the alias.
