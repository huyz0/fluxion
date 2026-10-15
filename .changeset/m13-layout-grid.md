---
'@fluxion/layout': minor
---

M13.7, the `grid` layout (columns, gap, align, padding; skips cells pinned boxes cover; bounded) and `wrap` for `stack`; both are registered by `registerBuiltInLayouts`, which now tries every built-in and returns the first refusal. `stack` is version 2: a box's cross-axis offset rounds down to the half pixel (fractional sizes only), so wrapped lines never overlap.
