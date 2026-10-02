---
'@fluxion/schema': minor
---

Inspector fields come from the Zod schemas' `.meta({ ui, group, order })` (`describeFields`, `elementFields`, `FieldDef`; ADR-0149). A schemaVersion that is not canonical (`1.00`, `01.0`, `1.01`) is refused rather than read as the current one.
