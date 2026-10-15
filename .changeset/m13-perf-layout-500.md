---
'@fluxion/studio': patch
---

M13.19, e2e (FR-LAY-007): `perf.layout-500.spec.ts` — no main-thread task over 50 ms while a 500-element Arrange is started and laid out in the worker. The write of the 500 new boxes is a separate, longer task that the spec reports but does not bound yet (backlog M13.31). The studio sets the performance mark `fluxion:arrange-apply` just before an Arrange writes its boxes.
