---
'@fluxion/core': minor
'@fluxion/format': patch
---

Stable ids for compiled records (ADR-0031): the `SyncHash128` port, `sha256Hash128` (SHA-256 truncated to 16 bytes), `base62`, `stableId` and `idKeys`. The pure SHA-256 (`sha256Bytes`, `sha256Hex`) moves from `@fluxion/format` to `@fluxion/core`; `@fluxion/format` re-exports `sha256Hex` (FR-DSL-002).
