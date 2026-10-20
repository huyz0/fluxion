---
'@fluxion/editor': minor
'@fluxion/core': patch
'@fluxion/geometry': patch
'@fluxion/theme': patch
---

Big screens open faster (NFR-PERF-002). The editor's hit index is built lazily, and `HitIndex.prepare()` builds it ahead of time. Shape path templates are parsed once per text. `nearestPoint` skips segments that cannot be nearer. A theme's token count is cached.
