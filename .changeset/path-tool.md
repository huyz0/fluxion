---
"@fluxion/editor": minor
---

Path editing for `core:path` shapes (FR-SHP-011): double-click one, or run "Edit path", to show its vertices and bezier handles. Dragging a vertex or handle reshapes the path in one undo step, a press on the outline adds a vertex there, Delete removes the selected vertex and Esc leaves. `Session` gains `pathEdit`, and `PathEditing` is exported. Migration: none, unless a custom `Session` is built by hand, in which case add `pathEdit: writable(undefined)`.
