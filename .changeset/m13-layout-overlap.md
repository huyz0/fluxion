---
'@fluxion/layout': minor
---

M13.10, the overlap pass (ADR-0034): `removeOverlap` leaves no unpinned box overlapping or within a margin (default 1 px) of another, never moves a pinned box or changes a size, and is deterministic (fixed separation passes, then relocation to the nearest free place, else past everything); `overlapCount` counts overlapping pairs; options `margin` and `preferAxis`.
