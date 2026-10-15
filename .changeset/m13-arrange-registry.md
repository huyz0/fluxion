---
'@fluxion/editor': minor
---

M13.35, Arrange for every registered layout (FR-LAY-001): `EditorRoot` builds `layout.arrange.screen.<id>` and `layout.arrange.selection.<id>` commands (`registeredLayoutCommands`, `registeredLayoutIds`) for each layout in the host's `layouts` registry besides `grid`, `layered` and `stack`; the palette and the context menus list them after the built-in lines.
