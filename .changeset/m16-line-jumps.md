---
'@fluxion/geometry': minor
'@fluxion/routing': minor
---

Line jumps (FR-CON-008): geometry's `polylineCrossings` finds the proper crossings between polylines by a sweep along x; routing's `findJumps` gives the crossing to the connector later in z-order (a document style, or `none` per connector), `createJumpCache` reuses the list while no route revision changes, and `hopPath` draws each hop as an arc or a gap.
