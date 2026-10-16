---
'@fluxion/dsl': minor
'@fluxion/schema': minor
---

M14.9, the patch resolver and validator (FR-AI-003): `resolvePatch(patch, { records, revision, registries })` resolves every reference of every op against a working copy (slugs, `#<RecordId>`, edge keys), accepts the plain and the strict form of a patch, and rejects the whole patch with pointer diagnostics. New codes `FLX_PATCH_STALE`, `FLX_PATCH_REF_UNKNOWN`, `FLX_PATCH_REF_AMBIGUOUS`, `FLX_PATCH_OP_INVALID`, `FLX_PATCH_CONFLICT` and `FLX_PATCH_TOO_LARGE`.
