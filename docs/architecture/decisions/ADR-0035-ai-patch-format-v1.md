---
status: accepted
date: 2026-10-16
decision-makers: harness (M14.2; within FR-AI-003 and 06-ai-authoring.md §5; no requirement changes)
---

# ADR-0035 — AI patch format v1: ops, references, atomicity, staleness, the strict schema subset

## Context and Problem Statement

An AI that edits an existing document should not regenerate it. 06-ai-authoring.md §5 sketches a patch of nine ops addressed by slug. M14 builds it (FR-AI-003): a resolver and validator in `packages/dsl/src/patch`, an `ai.applyPatch` command, a generated JSON Schema, a CLI `patch` command, and later (M15) the MCP `fluxion.patch` tool. All of them read one frozen format, so a model, a provider's structured-output mode and the engine agree on what a patch is. This ADR freezes the format and the rules that make it safe to apply.

## Decision Drivers

- FR-AI-003: atomic ops addressed by slug; any invalid op rejects the whole patch with pointer diagnostics; one undo entry; stale base rejected.
- A model names things the way the document does (slugs, edge keys), never record ids it has not seen; ids stay available (`#<RecordId>`) for tools that do hold them.
- Providers' strict structured-output modes accept a subset of JSON Schema: `additionalProperties: false`, no `oneOf` over open objects, no recursion depth beyond a stated bound.
- One vocabulary: payloads reuse the FluxScript node, edge, style, step and interaction schemas (ADR-0030), so a model learns one thing.
- Commands remain the only way to change a store (ADR-0014); a patch lowers to commands inside one transaction.

## Considered Options

1. **RFC 6902 JSON Patch over the canonical JSON.** Standard, but it addresses records by array index or id and carries coordinates; the model must know the canonical shape (NFR-AI-003: three times the tokens).
2. **A patch of intent ops over FluxScript vocabulary (chosen).** Small, named ops; payloads are FluxScript fragments; geometry is computed by the engine.
3. **Send the whole new FluxScript and diff it.** Simple to prompt, but it costs the whole document in tokens each time and makes a stable-id diff the engine's guess.

## Decision Outcome

Option 2.

**Patch.** `{ flux: 1, baseRevision?: string, ops: PatchOp[] }`, at most `MAX_PATCH_OPS` (200) ops. The ops are exactly the nine of 06 §5: `add`, `update`, `remove` (with `cascade`), `connect`, `disconnect`, `setLayout` (with `relayout`), `restyle` (explicit targets or a `select` selector), `addStep`, `addInteraction`. A tenth op needs a new ADR.

**References.** `Ref` is a string with this grammar: `#<RecordId>` (a record id, exactly as ADR-0012 prints it); an **edge key** `from->to` or `from~>to` (the arrow of the edge shorthand, ADR-0030; `from.anchor->to` is not a key, anchors belong to `connect`); otherwise a **slug**. A slug is resolved inside the op's screen when the op names one (`add.screen`, or the screen of the first reference of an op that has none), otherwise it must be unique in the document. A slug that matches nothing is `FLX_PATCH_REF_UNKNOWN`; one that matches in several screens with no screen to pick is `FLX_PATCH_REF_AMBIGUOUS`. Slugs added by an earlier op of the same patch are visible to later ops (resolution is sequential over a working copy), so `add` then `connect` works in one patch. An edge key that matches several edges is ambiguous and must be written as `#<RecordId>`.

**Atomicity.** The patch runs as one `ai.applyPatch` command in one `store.transact`. The validator resolves and checks every op against the working copy before anything is written; any error rejects the whole patch and nothing changes. Success creates exactly one undo entry whose undo restores the document byte for byte. Diagnostics carry a JSON Pointer into the patch (`/ops/3/target`), a code and a one-line hint, in the shape of ADR-0030's diagnostics, so the LLM formatter (M14.11) ranks them with compile errors.

**Staleness.** `baseRevision` is the document revision printed as `r<N>`, where `<N>` is the store's revision counter as a decimal integer (`r41`); every client (CLI `--json`, MCP, studio) prints and compares exactly that form. When present, it is compared with the document's revision **inside the same `store.transact` as the apply**, before the first op is read, so no edit can slip in between the check and the write; a difference is `FLX_PATCH_STALE`. When absent, the patch applies to whatever the document is. Reading the revision is how a client opts in to the check.

**Layout.** Containers an op touched are re-laid out incrementally by the M13 pipeline, with pins respected (ADR-0034), unless the op carries `relayout: false`. A transaction cannot await, so `ai.applyPatch` calls the synchronous `layoutSync` of ADR-0033 inside the transaction (never the asynchronous engine or the worker); a layout failure (a result, ADR-0144) rejects the whole patch and rolls the transaction back. Undo therefore restores boxes with the content, and no other edit can interleave with a half-applied patch.

**Strict schema subset.** The patch JSON Schema is generated from Zod (`z.toJSONSchema`) in a flat form for providers: every object has `additionalProperties: false`, every field is listed under `required` (optionals are `type: [T, 'null']`), `op` is the discriminator of an `anyOf` of the nine object schemas, FluxScript payloads (`NodeSpec` and the others) are inlined to a fixed depth with the open parts (`style` tokens, free text) typed as strings or bounded objects. A fixture of the published provider rules (`packages/dsl/src/patch/__fixtures__/provider-rules.ts`) is checked by a test. The non-strict schema, with the full payloads, is generated beside it for validators and editors.

**Failures** are results (ADR-0144): the validator returns `{ ok: false, diagnostics }`; `ai.applyPatch` surfaces them as the command's failure. Codes: `FLX_PATCH_STALE`, `FLX_PATCH_REF_UNKNOWN`, `FLX_PATCH_REF_AMBIGUOUS`, `FLX_PATCH_OP_INVALID` (a payload that fails its schema), `FLX_PATCH_CONFLICT` (a slug that already exists, a removal that leaves a dangling connector without `cascade`), `FLX_PATCH_TOO_LARGE`.

**A worked patch.** Add a cache to the `checkout` screen, connect it, restyle two nodes, and re-lay the screen out:

```json
{ "flux": 1, "baseRevision": "r41", "ops": [
  { "op": "add", "screen": "checkout", "slug": "cache", "node": { "shape": "cylinder", "label": "Cache" } },
  { "op": "connect", "edge": "api -> cache: reads" },
  { "op": "restyle", "targets": ["api", "cache"], "style": { "tone": "accent" } },
  { "op": "setLayout", "scope": "checkout", "layout": { "type": "layered", "direction": "right" } } ] }
```

If `baseRevision` is not the document's, the result is `FLX_PATCH_STALE`. If `api` does not exist, it is `FLX_PATCH_REF_UNKNOWN` at `/ops/1/edge` and nothing is added.

### Consequences

- Good: a model edits by name in a few tokens; the engine places and routes; the same format serves the CLI, the MCP tool and the studio.
- Good: atomic, one undo step, and a stale-base check make concurrent edits by a person and an agent safe to reason about.
- Bad: the strict subset forces inlining and nullable optionals, so the strict schema is longer than the plain one; the catalog budget (NFR-AI-002) counts the plain one.
- Bad: sequential resolution means an op's meaning depends on earlier ops; a model that reorders them can break a patch. The diagnostic names the op and the slug.
- Bad: nine ops cannot say everything (moving a node between screens, reordering steps); those are `remove` plus `add` until a later ADR adds an op.

### Confirmation

M14.5 (schema generation and the provider-rules fixture), M14.9 (fixtures `packages/dsl/src/patch/__fixtures__/*.json`: one valid patch per op, and an invalid one per code, each rejected whole with its pointer), M14.10 (one undo entry; undo restores the document, as a property test; `FLX_PATCH_STALE`), M14.16 (`fluxion patch` applies a fixture patch).

## More Information

06-ai-authoring.md §5; ADR-0012 (ids), ADR-0014 (commands and transactions), ADR-0030 (grammar and diagnostics), ADR-0031 (stable ids), ADR-0034 (pins in the layout), ADR-0144 (results).

## Amendment (M14.5, 2026-10-16): what the generated schemas settled

- **Node payloads** are the keys the FluxScript reader knows (`shape`, `text`, `label`, `tone`, `style`, `pin`, `alt`); a test ties `NODE_SPEC_KEYS` to the reader's key table (ADR-0030), so the patch and the compiler cannot drift apart. Keys the reader defers (`component`, `image`, `icon`, `badge`, `props`, `near`) join the payload when the compiler compiles them.
- **Free-key records** (a `style` map) are objects in the plain schema and `{ key, value }` arrays in the strict one, because the strict subset has no open objects. The resolver (M14.9) accepts both forms and reads the pair form back into the map.
- **Layout intents** in the strict schema carry the options of the built-in layouts under the names their `parseOptions` accepts (`direction`, `spacing`, `nodeGap`, `rankGap`, `gap`, `columns`, `align`, `padding`, `wrap`); a plugin layout's own options travel in the plain schema and in the CLI only. (The first text of this amendment said `dir`; the cheat sheet's compiling example (M14.7) showed the names were wrong.)  The worked patch above was corrected to `direction: right` in the same commit.
- **`addStep` and `addInteraction`** have bounded v1 payloads (`label` and `reveal`; `on`, `do` and `to`). They are in the schema so a model can emit them, and the resolver rejects them with `FLX_PATCH_OP_INVALID` and a hint until steps and interactions compile (M18).
- **Object depth**: the strict schema stays within five levels of nested objects, the common limit of the providers' structured output (`packages/dsl/src/patch/__fixtures__/provider-rules.ts`); arrays and unions add none.
- **Files**: `specs/schema/flux-document.schema.json` (the document file, from the Zod records of `@fluxion/schema`), `ai-patch.schema.json` and `ai-patch.strict.schema.json` (from `@fluxion/dsl`'s patch Zod schema). Each is a Vitest file snapshot (`vitest -u` rewrites it) and a drift test fails when the code and the file differ. A FluxScript JSON Schema is not generated here (see M14.25).
