---
"@fluxion/editor": minor
"@fluxion/studio": patch
---

My shapes lists an item whose pack shapes have other geometry here (an installed first-party pack changed since the item was saved) as unavailable, with the reason shown, instead of offering an insert that is refused. `MyShapesPacks` gains an optional `check`, `MyShapesSectionProps` an optional `checkPacks`, and `myShapePacksCheck` builds the check over a lookup that reads a shape's definition without registering it; the studio's catalog reads installed definitions that way.
