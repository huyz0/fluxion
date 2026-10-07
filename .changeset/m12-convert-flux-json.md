---
'@fluxion/cli': minor
'@fluxion/format': patch
---

`fluxion convert` turns a `.flux` into a `.flux.json` and back, with `--assets inline|external` (ADR-0162, FR-FIL-005); the reply's `direction` adds `to-json` and `from-json`. `writeFluxJson` refuses an assets folder name its reader would refuse.
