---
'@fluxion/schema': minor
'@fluxion/routing': minor
'@fluxion/format': patch
---

Anchor kinds (ADR-0043, FR-ANC-003): an `AnchorDef` takes `kind` (`fixed`, `side`, `perimeter`, `center`), `side` and `t`, and schema 1.4 with a `1.3 → 1.4` migration. `resolveAnchor` resolves a named anchor by its kind. The lean reader also opens 1.3.
