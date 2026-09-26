---
status: accepted
date: 2026-09-26
decision-makers: Fluxion maintainers
---

# ADR-0004 — FluxScript: a YAML-shaped authoring DSL; AI never computes coordinates

## Context and Problem Statement

AI is Fluxion's primary author (01-scope). Models must produce valid, good-looking documents of 10+
screens in one shot ≥ 90 % of the time, and ≥ 99 % after one repair round (NFR-AI-001). The
canonical JSON is verbose, and it tempts models into coordinate arithmetic they do badly. What
should models write?

## Decision Drivers

- Token efficiency: at least 3× cheaper than canonical JSON (NFR-AI-003).
- Familiar surface that models have seen widely in training (YAML, Mermaid-like edges).
- Streamable: each screen compiles on its own as it arrives (FR-AI-010).
- Diagnostics with line/column and did-you-mean fixes (FR-DSL-006).
- Round-trip: documents refined by humans can be read back compactly (FR-DSL-008).
- Deterministic engine-side layout, routing and styling.

## Considered Options

1. Models write canonical JSON via structured outputs
2. Adopt Mermaid / D2 / PlantUML as the authoring language
3. Markdown slide DSL (Marp/Slidev style)
4. A novel terse syntax (TOON-like)
5. FluxScript: YAML 1.2 document + edge shorthand + slugs + intents, compiled by `@fluxion/dsl`

## Decision Outcome

Chosen option: **5 — FluxScript** (`*.flux.yaml`). The model states entities, relations, layout
intent, theme variants (`tone: accent`), steps and interactions. The compiler resolves slugs,
expands templates and macros, applies theme defaults, lays out with the pure `layout` package and
an injected `TextMeasurer`, validates, and lints. Coordinates are optional (`pin:`) and never
required. A decompiler emits FluxScript for read-back. Incremental edits use the typed AI patch
format, which reuses FluxScript sub-schemas. Mermaid and Markdown are accepted as embedded blocks
and as importers, not as the core language.

### Consequences

- Good, because generation is cheap, streamable, and robust to small errors (repair loop with ranked
  diagnostics).
- Good, because one vocabulary serves FluxScript, AI patches, MCP tools and the catalog.
- Good, because the geometry quality depends on our engines, which we can improve without
  retraining prompts.
- Bad, because we own a language: grammar, JSON Schema, docs, editor tooling (FR-DSL-009) and
  decompiler idempotence.
- Bad, because YAML has pitfalls (indentation, implicit types). Mitigated by the schema, a strict
  set of scalars, and diagnostics that point to the line.

### Confirmation

Every documentation example compiles in CI. `compile(decompile(doc))` idempotence property test.
The token-ratio test (NFR-AI-003) and the `pnpm eval` scorecard (NFR-AI-001/004) gate releases.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| Canonical JSON | one step, schema-constrained decoding | 3–10× tokens; coordinates; large schemas degrade strict mode |
| Mermaid/D2 | well known, compact | no screens, themes, steps, interactions; extending means forking |
| Markdown slides | native for models | weak for diagrams and spatial intent |
| Novel terse syntax | fewest tokens | lower accuracy for unfamiliar formats |
| FluxScript | familiar, compact, streamable, full expressiveness | language maintenance |

## More Information

Research: `docs/research/04-file-format-ai-generation-theming.md` §B.1–B.3, §D.6–D.7. Architecture:
`../06-ai-authoring.md`. Requirements: `../../requirements/20-ai-authoring.md`.
