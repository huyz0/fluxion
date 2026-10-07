---
status: accepted
date: 2026-10-07
decision-makers: harness (M12.2; freezes the grammar ADR-0004 chose, within FR-DSL-001/002/005/006; no requirement changes)
---

# ADR-0030 — FluxScript grammar v1: what `flux: 1` means, what R2 compiles, and the diagnostic codes

## Context and Problem Statement

ADR-0004 chose FluxScript, and 06-ai-authoring.md §2 sketches its grammar. M12 builds the compiler. Prompts, examples, the TextMate and Lezer grammars,
completion and the decompiler all depend on the grammar, so it has to be fixed before any of them is written. The sketch also names more than R2 can compile:
animation steps and interactions are R3 work (M22, M24), the Mermaid and Markdown importers are M15, `raw:` escape blocks are M20, and auto layout is M13.
What does a `flux: 1` file contain? What does M12 compile, and what does it read and keep without compiling? Which diagnostic codes does it report?

## Decision Drivers

- FR-DSL-001: every documented example compiles. FR-DSL-002: the constructs it lists compile.
- FR-DSL-005: pins are respected, and elements without pins are placed.
- FR-DSL-006: errors give line, column, message and a did-you-mean fix.
- FR-AI-010: each screen compiles on its own.
- Prompts written for v1 must keep working (ADR-0004: grammar churn is the main risk).

## Considered Options

1. **Compile only what R2 can do, and reject the rest as unknown keys.** Strict and simple, but a file written for a later grammar (steps, interactions) fails
   today, and a model learns to leave out sections the documentation describes.
2. **Read the whole v1 grammar now, compile the R2 subset, and keep the rest.** Deferred sections give an `FLX_DSL_NOT_YET` warning and are stored verbatim in
   `document.source` (ADR-0031), so nothing is lost and a later compiler picks them up. Costs: a key table that names every v1 key now, and a test that a
   deferred section survives the compile.
3. **Version each section separately** (`steps@2`). This is flexible, but the model has more to remember, which goes against ADR-0004's familiarity driver.

## Decision Outcome

Chosen option: **2**. The grammar below is `flux: 1`. Changes within `flux: 1` are **additive only**: new optional keys, new edge-object fields and new
diagnostic codes are allowed. Changing or removing a key or an op needs `flux: 2` and a superseding ADR.

### Syntax

- **YAML subset.** The input is YAML 1.2 with the core schema, parsed by `yaml` with `keepSourceTokens` and a `LineCounter`. Anchors, aliases, tags and
  duplicate keys are errors (`FLX_DSL_SYNTAX`), because they hide structure from the source map and from models.
- **Top level.** `flux` (required; must be `1`, else `FLX_DSL_VERSION`), `title` (required), `theme`, `uses`, `vars`, `settings` and `screens` (required, a
  sequence).
- **Slug rule.** Slugs match `[a-z][a-z0-9-]*`. Node and group slugs are unique per document (`FLX_DSL_DUP_SLUG`) and become `element.semantic.slug`. Screen
  `id`s follow the same rule in their own namespace. A malformed slug is `FLX_DSL_BAD_SLUG`. Ids are derived from slugs (ADR-0031).
- **Edges.** The shorthand is `"<end> <op> <end>"`, optionally followed by `: label` or `: { … }`. `end := slug ( "." anchor )?`, where the **anchor suffix**
  is `n`, `e`, `s`, `w` or a named anchor of the end's shape (`FLX_ANCHOR_UNKNOWN` when the shape has none of that name). The edge ops are:

  | op | meaning |
  |---|---|
  | `->` | arrow at the target |
  | `<-` | arrow at the source end (written left to right, points left) |
  | `<->` | arrows at both ends |
  | `--` | no arrows |
  | `~>` | async: dashed, arrow at the target (its flow animation is deferred) |

  The tokenizer is hand-written. Any other spelling is `FLX_DSL_EDGE_SYNTAX`, reported at its column. The object form `{ from, to, op?, label?, style?,
  route? }` says the same thing with keys instead of the shorthand.
- **Unknown keys** anywhere are `FLX_DSL_UNKNOWN_KEY`, with a did-you-mean hint drawn from the keys valid at that position.

### What R2 compiles and what it defers

| Where | Compiled in R2 (M12) | Read, kept in `document.source`, `FLX_DSL_NOT_YET` |
|---|---|---|
| top level | `flux`, `title`, `theme` (`preset` or `name`, token `overrides`), `uses`, `screens` | `vars`, `settings`; in `theme`: `mode`, `accent` (palette seeds) |
| screen | `id`, `title`, `layout`, `background`, `nodes`, `groups`, `edges`, `notes` | `kind` (archetypes) with its arguments, `steps`, `interactions`, `breakpoints`, `markdown`, `mermaid`, `raw` |
| node | `shape`, `text`, `label`, `tone`, `style` (token names), `pin`, `alt` | `component`, `image`, `icon`, `badge`, `props`, `near` |
| group | `label`, `contains`, `style`, `layout` | — |
| edge | the five ops, anchors, `label`, `style`, `route` (`straight`, `curved`, `orthogonal`, `polyline`) | `flow`, `riders` |

**Nested objects.** The table names keys at the levels it lists. Below them:

- `pin` is `{ x, y, w?, h? }` in screen units; anything else in it is `FLX_DSL_UNKNOWN_KEY`.
- `layout` (screen and group) is `{ type, …options }`. `type` names a `layouts` registry entry. The options belong to that layout and are checked against the
  layout's own option schema (for example `direction` and `spacing` for `layered`), not against this table. In R2 an unknown `type` falls back to `stack`
  with `FLX_DSL_NOT_YET`.
- `style` takes the element style keys of the document schema, with token names as values. A string `style` is a stroke preset: `solid`, `dashed` or
  `dotted` (the example's `style: dashed` group).
- `theme.overrides` is a token map, and `props` is deferred whole.
- With `kind:` set, every other key of the screen except `id` is an archetype argument (`subtitle` in the example). The arguments are deferred together with
  `kind` and are never checked against the screen column.

A deferred section is not an error. The compile still succeeds, and the section's text and source range are kept, so `decompile` can write it back and a
later compiler can compile it.

### Pipeline stages in R2

The stages are **parse → resolve → expand → style → place → validate**. 06-ai-authoring.md §3 lists seven stages. In R2, its *layout* stage is **place**:
pins are kept exactly, and unpinned elements go through the screen's `layout` from the `layouts` registry, falling back to the built-in `stack`. Text is not
measured yet: a node takes its shape definition's default size. `layered` and measured sizes come in M13. Its *lint* stage comes in M14. Expand handles
groups only; archetypes, `dslMacros` and the importers come with their milestones.

### Diagnostic codes

The registry is `packages/dsl/src/diagnostics/codes.ts`: code, default severity and a one-line description. The docs page is generated from it. Codes are
stable: added, never renamed. The v1 codes are (ten):

| Code | Severity | When |
|---|---|---|
| `FLX_DSL_SYNTAX` | error | YAML that does not parse, or uses anchors, aliases, tags or duplicate keys |
| `FLX_DSL_VERSION` | error | `flux` missing, or not `1` |
| `FLX_DSL_UNKNOWN_KEY` | error | a key not in the v1 grammar at that position |
| `FLX_DSL_EDGE_SYNTAX` | error | a malformed edge |
| `FLX_DSL_BAD_SLUG` | error | a slug or screen id that breaks the slug rule |
| `FLX_DSL_DUP_SLUG` | error | a slug used twice |
| `FLX_DSL_UNKNOWN_SHAPE` | error | a shape not found through `uses:` |
| `FLX_DSL_AMBIGUOUS_SHAPE` | error | a short shape name found in more than one used pack |
| `FLX_DSL_UNKNOWN_PACK` | warning | a pack in `uses:` that is not registered (its shapes are then unknown) |
| `FLX_DSL_NOT_YET` | warning | a v1 section this compiler keeps but does not compile |

The compiler also reports the schema codes it shares (`FLX_REF_MISSING`, `FLX_TOKEN_UNKNOWN`, `FLX_ANCHOR_UNKNOWN`, `FLX_SCHEMA_*`) with their schema
severities, and fills in `source`. `FLX_DSL_MACRO_ARGS`, `FLX_LAYOUT_OVERFLOW` and `FLX_LINT_*` are added by the milestones that produce them.

### Consequences

- Good, because a prompt written to the full v1 grammar compiles today, minus the deferred sections, and nothing in it is lost.
- Good, because the grammars, completion and the decompiler are written once, against a fixed key table.
- Bad, because the key table names keys R2 does not compile, so a test must show that each one warns and is kept.
- Bad, because shape default sizes make R2 layouts rough until M13 measures text.

### Confirmation

- `m12-complete`'s ADR leg checks that this ADR names the slug rule, each op, the anchor suffix, `FLX_DSL_NOT_YET`, `codes.ts` and the additive rule.
- The parse and edge tests (M12.8, M12.9) cover every key and op in the tables above.
- `checkout.flux.yaml` (M12.17) compiles with only `FLX_DSL_NOT_YET` warnings.
- The diagnostics leg checks that every code in `codes.ts` is on the docs page.

## More Information

ADR-0004 (FluxScript), ADR-0031 (stable ids, `document.source`), ADR-0032 (source view). Architecture: 06-ai-authoring.md §2–§4. Requirements: 20-ai-authoring.md.
