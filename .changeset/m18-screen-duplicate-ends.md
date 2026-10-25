---
'@fluxion/core': patch
'@fluxion/editor': patch
---

Preserve outside-bound connector endpoints when duplicating a screen. The navigator supplies
resolved endpoint points; direct callers can pass the additive `freeEnds` command argument.
Missing or malformed geometry refuses atomically, preserving source records and exact undo.
