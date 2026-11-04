---
"@fluxion/format": minor
"@fluxion/studio": patch
---

`savedConnectorEntries` takes an optional `onDropped(pack, ids)` and calls it with the used connector type ids whose earlier definitions a save could not carry; the studio logs them as a warning.
