---
'@fluxion/format': minor
---

`@fluxion/format/player` (ADR-0026): the loader's container half with a lean document reader in place of the validating one (`loadFluxLean`, `leanDocumentText`), for the one-file player, which ships no validator. It refuses a document of another schema version or one it cannot read, and leaves out and lists the records that are not well formed; it migrates, repairs and salvages nothing, so the studio is where such a file is opened. `loadFlux` is unchanged.
