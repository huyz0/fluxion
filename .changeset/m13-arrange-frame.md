---
'@fluxion/layout': patch
---

M13.34, Arrange starts where the screen is (FR-LAY-005): `layout.arrange` passes the screen's area (its size, or the viewport of an infinite screen) to the layout, and a selection is laid out from its own corner instead of the top-left of a 1920 x 1080 default.
