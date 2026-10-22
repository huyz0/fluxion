---
'@fluxion/schema': minor
'@fluxion/format': patch
'@fluxion/player-inline': patch
---

Template layout specs (ADR-0047, FR-LAY-014): `LayoutSpec` takes `id` (a template id) and `items` (`TemplateItem`: `label`, `detail?`, `children?`), both required when `type` is `template`, with schema 1.7 and a `1.6 → 1.7` migration that removes a template spec that cannot be built again and a non-conforming `id` or `items`. `TemplateItem` and `templateItemSchema` are exported. The lean reader also opens 1.6. Items nest at most `MAX_TEMPLATE_DEPTH` (64) deep, checked before parsing, so a hostile value is an error, never a stack overflow. The player scripts mark Zod schema construction pure, so schemas they never read are dropped.
