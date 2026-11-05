---
"@fluxion/editor": patch
---

The camera commands (fit, 100 %, zoom to selection) read the canvas's box when they run, so a key pressed just after the canvas is resized (focus mode, a panel, the window) fits the new size on the first press. `EditorKeysInput` takes an optional `measure`.
