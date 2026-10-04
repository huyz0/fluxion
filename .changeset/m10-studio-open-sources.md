---
'@fluxion/studio': minor
---

The studio opens a file from more places (FR-FIL-006): `?src=<url>` fetches an `http(s)` `.flux` (refused past 100 MB, a failure shown as a line), a pasted `.flux` outside a text field opens, and the installed app registers as a handler of `.flux` and `.flux.html` files (web manifest `file_handlers`, `launchQueue`), keeping the file's handle so Save writes over it.
