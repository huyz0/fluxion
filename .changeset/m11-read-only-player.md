---
'@fluxion/player-inline': patch
---

The one-file player opens its document read-only (FR-PRS-004): its store refuses every transaction, so nothing a viewer does can change the document it shows.
