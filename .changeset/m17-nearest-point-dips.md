---
'@fluxion/geometry': patch
---

`nearestPoint` no longer misses a dip narrower than its coarse sampling: after the samples it runs a branch and bound over halves of each segment, pruning pieces whose control box is no nearer than the best point found (FR-CON-001; the M16 counterexample of seed 1847412959).
