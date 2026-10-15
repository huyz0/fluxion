---
'@fluxion/layout': patch
---

M13.18, benches and host minors (NFR-PERF-005, FR-LAY-007): `layered` ranks a graph of more than 200 nodes with dagre's `tight-tree` ranker (a quarter of the time of `network-simplex` at 500 nodes); the layout host refuses a revision that is not a finite number with `LAYOUT_INPUT_INVALID`.
