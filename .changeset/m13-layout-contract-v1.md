---
'@fluxion/layout': minor
---

M13.5, layout contract v1 (ADR-0033): `LayoutAlgorithm` now carries a required Zod `schema` and `capabilities`, and `run` takes an optional `LayoutCtx`; nodes gain `parentId` and `hints`, inputs gain `edges` and `scope`, outputs gain `metrics` and `fingerprint`. New `registerLayout`, `listLayouts` and `layoutOptionsJsonSchema`. The `stack` layout declares its options schema.
