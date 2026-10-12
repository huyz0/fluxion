---
'@fluxion/editor': patch
---

A move, nudge, resize or rotation writes positions, sizes and turns rounded to 2 decimals (no more `109.99999999999997` in the Source view); the Source view looks at canvas changes at most 1 s after the first, however long a drag or churn keeps restarting its 50 ms wait.
