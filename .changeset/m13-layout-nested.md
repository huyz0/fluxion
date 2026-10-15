---
'@fluxion/layout': minor
---

M13.12, nested containers (FR-LAY-005): `layoutNested(input, runner, { inset })` lays out containers bottom-up through a per-level `NestedRunner`; a container nothing pins is sized to its children plus an inset, one that is pinned or holds a pinned node keeps its box, and a missing, self or cyclic `parentId` makes the node a root.
