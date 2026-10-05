---
'@fluxion/player': minor
'@fluxion/player-inline': patch
---

Deep links (FR-PRS-005): with `links` the deck keeps its position in the URL hash as `#/<screen id>/<group>`: a new screen is a history entry, a build group replaces it, a reload or a shared link opens at the position, and the browser's back and forward move the deck. The one-file player turns it on; `mountPlayer` takes `{ links, background }` options. `parseLink`, `formatLink` and `bindLinks` are exported.
