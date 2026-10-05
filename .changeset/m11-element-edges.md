---
'@fluxion/player': patch
---

`<fluxion-player>`: a load still opening when a newer `src` fetch fails no longer draws its deck over the error, a failed element moved in the page neither fetches again nor reports twice, and a `load(bytes)` pending on a moved element is not doubled (FR-PRS-009).
