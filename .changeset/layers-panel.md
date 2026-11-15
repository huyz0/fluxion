---
'@fluxion/core': minor
'@fluxion/editor': minor
---

The Layers tab lists the shown screen's elements as a tree, front first (FR-ARR-008). Dragging a row among its siblings reorders it with the new core command `element.reorder`, which writes only the moved element's index; Alt+ArrowUp/ArrowDown steps it forward or back; the eye toggles `hidden` and the lock toggles the position, size, rotation and select locks. Each change is one undo step.
