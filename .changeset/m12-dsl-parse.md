---
'@fluxion/dsl': minor
---

The parse stage: `parseFlux` turns FluxScript into a tree of maps, sequences and scalars in which every node and key keeps its line, column and offsets; anchors, aliases, tags and duplicate keys are `FLX_DSL_SYNTAX` (FR-DSL-001, ADR-0030).
