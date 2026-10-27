---
"@fluxion/sdk": minor
---

Add `createArtworkShapePackLoader`, a version-aware pack loader whose `acquire` returns a definition with its exact verified artwork font bytes (owned copies) and covering font credits, or diagnostics and nothing on mismatch or cancellation (ADR-0192). `createShapePackLoader` is unchanged and refuses pack 1.1.
