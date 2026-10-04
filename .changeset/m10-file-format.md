---
'@fluxion/schema': minor
'@fluxion/core': minor
'@fluxion/format': minor
'@fluxion/player': minor
'@fluxion/player-inline': minor
---

M10, file format and persistence: `.flux` packages (own deterministic zip codec, manifest with entry hashes, content-addressed assets), `.flux.html` pages that carry the player and open offline under a strict CSP, lossless conversion between them, a loader that repairs and salvages, image import (magic-byte sniffing, 2560 px cap, WebP, an allowlist SVG sanitizer), embedded fonts with their licence lines, and the player's loading of a file's own fonts. The format is specified in `specs/format/flux-1.0.md` (FR-FIL-001..009, FR-AST-001..005, NFR-SIZE-003/004, NFR-SEC-002).
