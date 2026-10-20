---
status: accepted
date: 2026-10-20
decision-makers: harness (M16.33; within FR-DSL-001, FR-CON-008; no requirement changes; the FluxScript change is additive)
---

# ADR-0169 — FluxScript keys for line jumps

## Context and Problem Statement

Schema 1.5 (ADR-0168) gave a connector's route a `jumps` style (`arc`, `gap` or `none`), and the document a `settings.lineJumps` switch, and M16.21 drew them. FluxScript, the authoring language (ADR-0030), had no way to write either: a file could not turn hops on, so a generated diagram never drew them and the routing showcase could not show them. The key table is a contract (the compiler, the JSON schema, the editor's highlighting and completion, the catalog), so a new key is decided here.

## Decision Drivers

- A file written for `flux: 1` keeps compiling to the same document: the change is additive.
- The key names what the document stores, so decompiling writes it back and the round trip holds.
- Few tokens for an AI author: one word at each level.

## Considered Options

1. **Compile the top-level `settings` section** (now kept but deferred) with a `lineJumps` key inside. Matches the record, but `settings` would become half compiled, half kept, and every other key a file writes there today would change meaning.
2. **A top-level `lineJumps: true | false` and an edge key `jumps: arc | gap | none` (chosen).**
3. **One top-level `jumps:` style.** The document's switch is a boolean (arcs or none, ADR-0168); a top-level `gap` would need a schema change.

## Decision Outcome

Option 2.

- **Top level:** `lineJumps: true` draws an arc where a connector crosses one painted before it, throughout the document; `false` (or absent) draws none. It compiles to the document's `settings.lineJumps`; `settings` stays a deferred section.
- **Edge:** `jumps: arc | gap | none` in the object form or after the shorthand's `:` sets that connector's `route.jumps`, which overrides the document's switch for it. Another value is `FLX_SCHEMA_INVALID` with the three named.
- **Decompile** writes `lineJumps` when the document sets it, and an edge's `jumps` when its route has one; a route with any other field beyond `type` and `jumps` is still outside the subset.
- The key table (`fluxScriptKeys`), the JSON schema, the cheatsheet and the authoring guide list both keys.
- Not covered: the edit language's edge patch (`patch/schema.ts`) does not take `jumps`; an author sets it in the file or the editor (backlog M16.35; done, see the amendment below).

## Consequences

- Good: a FluxScript file can turn hops on, per document or per edge, and the routing showcase is written in FluxScript.
- Neutral: `FluxAst` and `EdgeAst` gain optional fields, so the dsl API report changes.
- Bad: none known.

## Amendment (M16.35, 2026-10-20): the edit language takes `jumps`

- **`connect`** takes `jumps: arc | gap | none` in its `spec`, as the file form does; it becomes the connector's `route.jumps`.
- **`update` of an edge.** An `update` whose target is an edge (its key `a->b`, or a connector's `#<RecordId>`) sets edge keys: `label` (the first label's text, which keeps its place and offset; the other labels stay; an empty label removes the first), `style` (merged), `route` (the type) and `jumps`. `jumps: default` removes the connector's own value, so the document's switch applies again. A strict patch's `null` means "absent", so clearing needs a value of its own.
- A node key on an edge, or an edge key (`route`, `jumps`) on a node, is `FLX_PATCH_OP_INVALID`, naming the key and the keys that target takes. The update's `set` is a union of the node payload and the edge keys in both generated patch schemas, and `EdgeSet` joins the dsl API.
