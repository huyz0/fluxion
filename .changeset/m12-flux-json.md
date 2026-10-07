---
'@fluxion/format': minor
---

The `.flux.json` variant (FR-FIL-005): `writeFluxJson` writes a document as one canonical, pretty JSON text, byte-identical for an identical document (records through `serializeDocument`), with assets inline as base64 or, with `assetsMode: 'external'`, as files `<name>.assets/<sha256>.<ext>` beside it; `readFluxJson` reads it back, external assets through a callback.
