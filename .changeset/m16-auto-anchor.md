---
'@fluxion/routing': minor
---

`chooseAutoSides`: the auto-anchor selector (ADR-0043). It picks the side of each end of a connector from the length, bends, pointing away, crowding and role mismatch weights of architecture 05 §8, keeps a previous side unless another is clearly better (hysteresis), freezes during a drag and gives an algorithm-assigned side a strong bonus.
