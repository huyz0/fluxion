---
'@fluxion/schema': minor
'@fluxion/core': patch
'@fluxion/format': patch
---

Schema 1.8 (ADR-0054): master screens (`screen.role: 'master'`, `hideMasterElements`, an element's `placeholder` and `fills`), the `table` element (weighted `rows` and `cols`, `cells` keyed `"r:c"` with spans, `tableStyle`) and theme `tableStyles`, a shape's `texts`, `icons` and `path` (ADR-0053), and `locks.aspect` and `locks.select`, with a `1.7 → 1.8` migration. `fills` and icon assets are checked references; core clears a `fills` whose placeholder is deleted, and an asset an icon slot uses counts as used when saving. The player's lean reader opens 1.7 files.
