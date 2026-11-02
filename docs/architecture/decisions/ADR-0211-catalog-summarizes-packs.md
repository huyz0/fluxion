---
status: accepted
date: 2026-11-02
decision-makers: packs stream (M18.41), subject to independent review
---

# ADR-0211 — The AI catalog lists core entries in full and every other pack as one line; a pack's entries come with `pack`

## Context and Problem Statement

`buildCatalog` (ADR-0037, 06-ai-authoring §6) lists every registered entry. With only the
built-ins and `basic` registered it fits AI_CATALOG_MAX_TOKENS beside the cheat sheet. M18 adds
eleven more first-party packs (cloud, network, uml, bpmn, lucide and others, several hundred
shapes): listed entry by entry they overflow the budget a model reads first (NFR-AI-002), and
FR-LIB-007 still asks that a model can find and use any pack's shapes in FluxScript.

## Decision Drivers

NFR-AI-002 (the catalog plus cheat sheet stay within AI_CATALOG_MAX_TOKENS), FR-LIB-007 (pack
shapes usable by name through `uses:`), the catalog JSON schema and SDK API as contracts
(AGENTS.md non-negotiable 6), one catalog builder for every host.

## Considered Options

1. **Core in full, other packs summarized, detail per pack on demand.** A host names the
   registrants it lists entry by entry (`core`); each other registrant becomes one summary line
   (id, display name, entry count, kinds) that says how to ask for it; a catalog built with
   `pack: <id>` lists that pack's entries in full. Chosen.
2. **Truncate descriptions or drop detail for every entry.** Still grows with each pack and loses
   the anchor and size detail a model needs to place shapes; rejected.
3. **Raise AI_CATALOG_MAX_TOKENS.** Weakens a gate (non-negotiable 2) and moves the problem to the
   next pack; rejected.

## Decision Outcome

- `CatalogOptions` gains `core?: readonly string[]` (registrant ids listed entry by entry) and
  `names?: ReadonlyMap<string, string>` (display names for the summary lines). Without `core`
  every registrant is listed, as before; `pack` still lists one registrant and ignores `core`.
- `Catalog` gains an optional `packs?: readonly PackSummary[]`, present only when `core` leaves
  some registrant out, sorted by id. `PackSummary` is `{ id, name, count, kinds }`; `name` falls
  back to the id.
- The llm format prints `packs:` with one line each, `<id> — <name>; <n> entries (<kinds>);
  listed with pack: <id>`; md prints a `## Packs` section; json carries the array. The catalog
  JSON schema adds `packs` as an optional property, so every catalog valid before stays valid.
- `FLX_REGISTRY_UNDESCRIBED` is reported only for listed entries; a summarized pack's entries are
  checked when its own catalog is built. Lucide's icons carry no `describe`, so its per-pack
  catalog reports them; that is the existing diagnostic, not new behaviour.
- A pack test reads all twelve first-party pack distributions as a host does and proves: the core
  catalog (`core: ['core', 'basic']`, full detail) plus the cheat sheet stays within the budget;
  each pack's own catalog lists all its shapes within the budget; every shape compiles through
  `uses: [<pack>]` by the short name its detail lists. The cloud architecture example renders to
  its golden through the examples host, which registers the cloud pack.

### Consequences

- Good: the first read stays bounded however many packs register; a model learns each pack exists
  and how to get its entries in one more call.
- Neutral: the CLI and MCP bundle only `basic` today and call `buildCatalog` without `core`, so
  their output is unchanged. A host that registers more packs passes `core` to stay in budget.
- Bad: a model must ask a second time for a summarized pack's entries; the summary line names the
  exact `pack` to ask for.

## Confirmation

`packages/dsl/src/catalog/pack-catalog.test.ts`, the catalog and format tests, the
`catalog.schema.json` snapshot, `check-api` on `packages/dsl`, and the
`examples/dsl/cloud-architecture.flux.yaml` golden in `scripts/dsl/examples.test.ts`.
