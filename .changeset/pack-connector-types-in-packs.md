---
"@fluxion/core": minor
"@fluxion/sdk": minor
"@fluxion/pack-arrows": minor
---

A declarative pack can carry connector types: `ShapePackDraft.connectors` is encoded as the pack's `connectors.json`, `PackSpec`/`Pack` gain `connectors`, and the pack check reads the file with `loadPackConnectors`. The arrows pack ships wavy, zigzag, double, pipe and cable connector types.
