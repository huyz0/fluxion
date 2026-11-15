---
"@fluxion/theme": minor
"@fluxion/render": minor
"@fluxion/core": minor
---

Tables draw (FR-SHP-014, ADR-0054). Render registers a `table` view: rows and columns share the box by weight, merged cells span theirs, and each cell is filled, bordered and lettered in the style it resolves (`tableCells`, `tableCellStyle`). Theme adds `Theme.tableStyles`, `ThemeTableStyle` and `BUILTIN_TABLE_STYLES` (`plain`, `banded`, `grid`); the light theme, and so every built-in theme, ships them; `themeOf` and `themeSchema` keep a theme's table styles; a table style a theme does not name falls back to the built-in one. Core's theme commands write a theme's `tableStyles` to its record. Migration: none.
