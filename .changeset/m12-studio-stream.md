---
'@fluxion/editor': minor
'@fluxion/studio': patch
---

`streamFluxScript` feeds a streamed FluxScript source into the open document screen by screen (one transaction per screen, one undo step for the stream; the compiler loads from a lazy chunk). The studio exposes it to its E2E specs through test-only hooks (FR-AI-010).
