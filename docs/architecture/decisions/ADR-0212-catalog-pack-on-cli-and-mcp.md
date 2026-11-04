---
status: accepted
date: 2026-11-02
decision-makers: packs stream (M18.218, M18.41 review F1), subject to independent review
---

# ADR-0212 — `fluxion catalog --pack` and `list_catalog({ pack })` return one pack's entries in full

## Context and Problem Statement

ADR-0211 lets a host list its core packs in full and every other pack as one line that ends
`listed with pack: <id>`. A model can follow that line only through a surface it can call:
06-ai-authoring names `catalog [--pack p]` (§9) and `list_catalog({ pack? })` (§10), but neither
takes `pack` (M18.41 review F1). Adding it changes the CLI `--json` reply and an MCP tool's input
schema, both contracts (AGENTS.md non-negotiable 6).

## Decision Drivers

FR-LIB-007 (pack shapes usable by name), FR-AI-002 (the catalog a model reads), FR-CLI-002 and
FR-MCP-001 (the command and the tool), ADR-0211 (summary lines name the `pack` to ask for).

## Considered Options

1. **An optional `pack` on both surfaces, through one ops function.** `catalogText(registries,
   format, { pack })` builds the catalog with `{ detail: 'full', pack }`; the CLI flag and the MCP
   argument pass it. Chosen.
2. **A separate `list_pack` tool and `pack-catalog` command.** Two more names for one catalog with
   a filter, and the summary line would have to name a different call; rejected.
3. **Leave the summary line without a call.** A model could not learn a summarized pack's short
   names; rejected.

## Decision Outcome

- `catalogText` takes `options?: CatalogTextOptions` (`{ pack?: string }`, exported from
  `@fluxion/cli/ops`). With `pack`, the catalog lists only that pack's entries, with full detail
  (params and options). A `pack` no registrant has is an error, `FLX_CLI_USAGE`, whose message names
  the pack and lists the registered ones (in the message, which an MCP tool error's text carries); nothing is printed or written.
- `fluxion catalog` takes `--pack <id>`; an empty or unregistered id exits 2. The `--json` result
  gains an optional `pack` (the id asked for); `specs/schema/cli-result.json` and
  `packages/cli/schemas/catalog.output.json` add it as optional, so every earlier reply stays valid.
- MCP `list_catalog` takes an optional `pack` (a non-empty string); its structured content carries
  `pack` when given. An unregistered pack is a tool error with the same diagnostic.
- Without `pack`, both return exactly what they did.

### Consequences

- Good: every summary line of ADR-0211 names a call that works, on both surfaces.
- Neutral: the CLI and MCP bundle only `basic`, so today `pack` narrows to `basic` or the built-ins
  (`core`); a host bundling more packs gets the expansion with no further change.

## Confirmation

The in-process CLI test and the MCP server test of `pack` (a listed pack in full, the default
unchanged, an unregistered pack refused naming the registered ones), and the generated schema
snapshots in `packages/cli/src/output.test.ts`.
