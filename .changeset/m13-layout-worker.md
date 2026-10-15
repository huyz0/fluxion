---
'@fluxion/layout': minor
---

M13.14, the layout worker (`@fluxion/layout/worker`, ADR-0033): `createLayoutHost(spawn)` runs jobs in a worker, cancels one with an `AbortSignal` (the worker is ended, the promise rejects with `AbortError`), and lets the newest revision of a scope supersede a running one; `serveLayoutWorker` and `runLayoutJob` are the worker side. The pipeline reports options that throw or cannot be fingerprinted as `LAYOUT_OPTIONS_INVALID`, tells `-0` from `0`, rejects a NaN order, prepares once per cache miss, and freezes its results. New error code `LAYOUT_ALGORITHM_UNKNOWN`.
