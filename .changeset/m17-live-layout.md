---
'@fluxion/editor': minor
'@fluxion/core': minor
---

Live layout frames (ADR-0046): `startLiveLayout` re-lays a group or frame whose `layout.live` is true after an edit adds, removes or resizes a child, as an amend of the edit's undo entry; a paste goes into the entered group. Core: an `amend` joins the last undo entry even when it was sealed, while nothing else was committed after it.
