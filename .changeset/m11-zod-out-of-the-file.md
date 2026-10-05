---
'@fluxion/player': patch
'@fluxion/player-inline': patch
---

The one-file player carries no Zod (ADR-0026 amendment): it reads a document with the lean reader (`@fluxion/format/player`), registers its bundled shapes and markers as they are, and the script resolves `zod` to an inert stand-in whose checks throw, so 167 kB becomes 139 kB gzip. A screen that throws while it draws is drawn as nothing and the keys still reach the next one.
