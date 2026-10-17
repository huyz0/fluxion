---
'@fluxion/routing': patch
---

The orthogonal search runs 200 routes in under a third of the budget (NFR-PERF-005): blocked steps and the nodes earlier routes pass across are precomputed per search, node state sits in typed arrays, and ties go to the deeper path with a bend counted in the estimate. A route now pays for arriving at a node that an earlier wire passes across, so crossings of on-grid wires are charged (before, only off-grid ones were).
