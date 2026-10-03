---
'@fluxion/schema': minor
---

Schema 1.2 (ADR-0152): the `document` record gains `description`, `tags` and `custom` (FR-DOC-006) and a `screen` gains `themeId`, its theme override (FR-THM-004), which must name a `theme` record. `SCHEMA_VERSION` is `1.2`; the migration `1.1 → 1.2` removes non-conforming values in those places and passes everything else through.
