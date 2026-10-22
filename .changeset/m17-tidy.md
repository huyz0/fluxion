---
'@fluxion/layout': minor
'@fluxion/editor': minor
'@fluxion/cli': patch
---

`tidy` layout (FR-LAY-011): a minimal-movement cleanup that aligns near-aligned boxes, snaps to the grid and removes overlaps with each move bounded; the editor's "Tidy up" command runs it on the selection, else the screen. `builtInLayouts` lists every built-in, and the studio's layout worker now serves all of them.
