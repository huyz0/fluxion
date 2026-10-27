---
"@fluxion/editor": patch
---

Ctrl/Cmd+C, X and V on the canvas go through a hidden editable target, so an engine that raises clipboard events only from an editable field (WebKit 26.5) copies and pastes across documents through the system clipboard.
