---
'@fluxion/core': minor
'@fluxion/editor': minor
---

Flip horizontally and vertically (FR-SHP-009). The core command `element.flip {ids, axis}` mirrors each element about its own centre, a group's or a frame's members with it, through the new `elementFlipped` (`frameFlipped` is removed); anchors are placed through the element's matrix, so a bound connector follows. The editor adds Flip horizontally and Flip vertically to the element menu and the command palette. `frameTurned` is removed: a frame turns through the rotate handle only, which carries its members.
