---
'@fluxion/format': minor
'@fluxion/cli': patch
---

`.flux.json` keeps an asset's own file extension through a round trip (inline as `ext`, external from its path) and accepts any extension the `.flux` loader does; the CLI writes its own version into the files it converts (FR-FIL-005).
