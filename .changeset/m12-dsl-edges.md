---
'@fluxion/dsl': minor
---

The edge tokenizers (`parseEdge` for the shorthand, `parseEdgeObject` for `{ from, to, op? }`, `EDGE_OPS`): `<end> <op> <end>` with the five ops and the anchor suffix; a malformed edge gives its column, a message and a fix, and `edgeDiagnostic` turns it into `FLX_DSL_EDGE_SYNTAX` at its line and column (FR-DSL-001, FR-DSL-006).
