---
'@fluxion/editor': minor
'@fluxion/studio': minor
---

M13.16, Arrange in the editor (FR-LAY-005, FR-LAY-001): editor commands `layout.arrange.screen.<layout>`, `layout.arrange.selection.<layout>` (layered, grid, stack) and `layout.arrange.container` appear in the palette and the element and screen context menus. Each runs the one `layout.arrange` command, so it is one undo step. The studio registers the built-in layouts, `layered` and that command in every opened document.
