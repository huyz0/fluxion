---
"@fluxion/format": patch
---

`readZip` checks the entry count, every declared entry size and their total against its limits before it inflates any entry, so an over-cap declaration is refused from the listing alone, whatever the earlier entries hold (M18.202). Migration: none.
