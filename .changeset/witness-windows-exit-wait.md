---
"@fluxion/cli": patch
---

On Windows the Node SVG witness's cleanup waits for the owned browser's observed exit, bounded by the session's 120 s lifecycle, instead of a fixed two seconds from close: a slow but working owned taskkill on a loaded host is a clean close, a failed one is still a cleanup failure, and the taskkill's bound is what is left of the lifecycle. The `WITNESS_CLEANUP` trace adds the helper's timings, exit code and signal (M18.195, ADR-0189 amendment). Migration: none.
