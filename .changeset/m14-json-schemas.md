---
'@fluxion/schema': minor
'@fluxion/dsl': minor
---

M14.4 and M14.5, JSON Schemas for agents (FR-AI-001, FR-AI-003): `@fluxion/schema` exports `documentJsonSchema()`, the JSON Schema of a document file generated from the Zod records. `@fluxion/dsl` exports the AI patch of ADR-0035 as a Zod schema (`aiPatchSchema`, `AiPatch`, `PatchOp`, `MAX_PATCH_OPS`, `NODE_SPEC_KEYS`) and its two JSON Schemas, `patchJsonSchema()` and the provider-strict `strictPatchJsonSchema()`. Committed copies live in `specs/schema/` and drift tests fail when they differ.
