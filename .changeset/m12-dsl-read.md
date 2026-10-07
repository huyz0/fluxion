---
'@fluxion/dsl': minor
---

The read stage (`readFlux`): the parsed tree checked against the `flux: 1` key table of ADR-0030 into a typed, located tree (`FluxAst`); unknown keys with the nearest valid one, the version, the slug rule and edges are diagnostics, and the sections R2 does not compile are `FLX_DSL_NOT_YET` warnings kept as source text by pointer (FR-DSL-001, FR-DSL-002, FR-DSL-006).
