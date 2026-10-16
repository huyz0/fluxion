---
'@fluxion/core': minor
'@fluxion/dsl': minor
---

M14.10, `ai.applyPatch` (FR-AI-003): `applyPatchCommand(registries)` / `registerApplyPatchCommand` resolve, lower (`lowerPatch`) and apply a patch in one transaction with one undo entry, lay out the touched containers, and reject a stale `baseRevision`. `Store.revision` (core) counts committed transactions, undo and redo included.
