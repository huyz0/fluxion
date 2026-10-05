---
'@fluxion/render': minor
'@fluxion/cli': patch
---

`renderDocumentToHtml` and its types are exported from `@fluxion/render/ssr` only, no longer from the root entry, so the player and the one-file player do not carry `react-dom/server` (the one-file player is 163 kB gzip, from 224 kB; ADR-0026). The CLI imports it from the new entry.
