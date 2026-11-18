---
'@fluxion/core': minor
'@fluxion/render': minor
'@fluxion/exporters': minor
---

SVG export draws tables (cells, borders, fills, merged cells, cell text), a shape's further text regions and icon slots, and rich-text marks: underline and strike, colour, highlight, outbound links and list markers. `layoutStyled` keeps each run of one font as a piece of its own (`LaidOutPiece.run`, `LaidOutLine.block`) and honours a block's own `align`. `@fluxion/render/svg` exports `TableSvg`.
