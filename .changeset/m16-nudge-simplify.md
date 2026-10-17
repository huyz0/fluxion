---
'@fluxion/routing': minor
---

`simplify` and `nudge`: the post-passes of the orthogonal router (ADR-0042). `simplify` drops collinear points and merges jogs under 4 px, keeping the ends and the stubs. `nudge` spreads segments of different routes that run side by side to at least the spacing, leaving end segments alone and any route a push would send into an obstacle.
