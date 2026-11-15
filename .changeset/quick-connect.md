---
"@fluxion/editor": minor
---

Quick-connect (FR-EDT-015). A hovered shape shows a "+" beyond each side; dragging one onto another element joins the two with a bound connector, and dropping it on empty canvas opens a mini library (the same shape, rectangle, rounded rectangle, ellipse, diamond, or the connector alone) whose choice adds the shape there joined to the first, as one undo step. `Session` gains `quickDrop` (type `QuickDrop`); `ContextMenu` takes an optional `label`.
