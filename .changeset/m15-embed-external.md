---
'@fluxion/format': minor
---

`embedExternalAssets` (FR-AST-006): an asset record that names a `source` URL is fetched through the `FileIO` read port on save, checked against a pinned hash, stored by its hash (deduplicated) and rewritten without the `source`, so the saved file renders with the network blocked. Only https addresses of public hosts are fetched (no plain http, loopback, private networks or credentials), and the studio does so only when the person turned `fluxion.embedExternalAssets` on. A URL that cannot be fetched stays external and is reported, never a failed save.
