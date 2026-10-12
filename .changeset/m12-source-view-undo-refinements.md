---
'@fluxion/editor': patch
---

M12.60, source view undo refinements: only the explicit Reload is a step of the text history; the automatic regeneration after a canvas change is not recorded and starts the history over, so Mod-z after a drag no longer restores the pre-drag text. Mod-u and Alt-u are no longer bound (Ctrl-U reaches the browser).
