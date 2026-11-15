---
"@fluxion/core": minor
"@fluxion/editor": minor
"@fluxion/render": minor
---

Tables edit (FR-SHP-014, ADR-0054). Core adds the pure grid operations `insertLine`, `removeLine`, `coveringArea`, `mergeCells`, `splitCell` and `stepCell` (types `TableGrid`, `TableAxis`, `CellArea`). The editor picks a table's cells by click and shift-click (`Session.tableCells`, `TableCellRange`), inserts a table from the palette, inserts and deletes rows and columns, merges and splits cells from the table menu, moves the picked cell with Tab and Shift+Tab, and resizes rows and columns by dragging their borders, each one undo step and refused on a table locked against editing. Render exports `tableCells`, `tableCellStyle`, `TableCellBox` and `TableView`; a cell's opacity now fades its fill and border with its text. Migration: none.
