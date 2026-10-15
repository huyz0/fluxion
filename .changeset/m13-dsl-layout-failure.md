---
'@fluxion/dsl': patch
---

M13.36, a failing layout is a diagnostic (FR-DSL-005, FR-LAY-004): when a registered layout throws or the layout pipeline refuses its result, the place stage reports `FLX_SCHEMA_INVALID` at the container's `layout` and places the nodes with the default layout, instead of throwing out of the compiler or leaving unplaced boxes. The `FLX_DSL_NOT_YET` message for an unregistered `layered` no longer says it comes in a later milestone.
