---
"@fluxion/core": patch
"@fluxion/render": patch
---

A drag with many connectors does less work per frame: a transaction that changes no record's references (a move, a restyle) skips the referential pass over the whole document, and a connector's screen-reader text re-reads only the names of the shapes it joins.
