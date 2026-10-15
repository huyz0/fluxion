---
'@fluxion/layout': minor
---

M13.8, the `layered` layout (`layeredLayout`, backed by `@dagrejs/dagre` 3.1.1, MIT): ranks down, right, up or left, spacing presets, pins keep their boxes. Every built-in now returns its boxes through `Object.fromEntries`, so a node id of `__proto__` keeps its box; snapshot hints do the same. `layered` is exported but registered by the DSL row (M13.17).
