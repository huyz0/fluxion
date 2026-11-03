---
"@fluxion/editor": minor
"@fluxion/format": patch
"@fluxion/studio": minor
---

My shapes items carry the pack subsets they use, with their credits and retained font bytes, in a `fluxion-my-shapes` 1.1 file. Inserting one registers the namespaces the document lacks, joins two items' shapes of one pack into one subset, and refuses a conflicting namespace; the next save embeds them (`MyShapesPacks`, `packsFor`, `myShapePackSet`, `mergeMyShapePacks`). A My shapes remove that storage refuses is now reported. `prepareUsedShapePacks` accepts any value with `records`.
