---
'@fluxion/editor': patch
'@fluxion/format': patch
---

A big screen opens faster: a document is validated once on open instead of twice, and the global routing pass waits for the browser to be idle after it settles, so it no longer runs between drawing a screen just opened and painting it.
