---
status: accepted
date: 2026-10-16
decision-makers: harness (M15.4; within FR-DSL-007 and FR-IMP-001; no requirement changes)
---

# ADR-0040 — Mermaid and Markdown import: hand-written subset parsers and `mdast`, both emitting FluxScript

## Context and Problem Statement

FR-DSL-007 and FR-IMP-001 ask for importers: Mermaid (flowchart, sequence-lite, mindmap, timeline, class and ER lite) and a Markdown outline, each turned into a document. An agent or a person often already has a Mermaid diagram or a Markdown outline; importing it is cheaper than describing it again. The question is how to parse them, in which package, and what they produce.

## Decision Drivers

- `@fluxion/dsl` is a pure-core package: no DOM, timers, clock, randomness, network or `node:*` (AGENTS.md rule 5). An importer must run there and in the browser studio.
- The result must go through the same compile, layout and lint as any authored file, so it is validated and laid out by code that already exists.
- Weight: the player is budgeted; an importer must not enter it. It is an authoring-time dependency.
- Bad input must give diagnostics with positions, never a throw or a silent drop (standards: diagnostics).
- Mermaid syntax is large; claiming all of it would mean a wrong result presented as a right one.

## Considered Options

1. **The `mermaid` package's parser.** Complete, but `mermaid` is built around a DOM (it renders SVG into a container), pulls several MB, and its parse step is not a stable public API per diagram kind.
2. **Hand-written parsers for a stated subset (chosen for Mermaid).** Small, pure, deterministic, exact diagnostics for what is outside the subset.
3. **A converter service.** Needs the network; rejected.

For Markdown: **`mdast-util-from-markdown`** (MIT, pure ESM, no DOM; the CommonMark parse tree of the unified ecosystem) against a hand-written line scanner. Headings, nested lists, code fences and inline markup are exactly where a line scanner is wrong; the tree is right.

## Decision Outcome

**Placement and output.** Both importers live in `packages/dsl/src/import/` (`mermaid/`, `markdown/`) and export `importMermaid(text, opts)` and `importMarkdown(text, opts)` returning `ImportResult = { ok: boolean; flux?: string; diagnostics: DslDiagnostic[] }`, the shape of `CompileResult` in the same package (`ok` is false when any diagnostic is an error, and `flux` is then absent; warnings ride along on success, which the one-error `Result` of ADR-0144 cannot carry). They emit **FluxScript text**, not a document: the caller compiles it with the existing `compile`. Output is deterministic (ids derive from the source's own names, slugged, de-duplicated by suffix; no counters shared across calls).

**Mermaid subset.** The first non-comment line picks the kind. Supported:

- `flowchart` / `graph` (TD, TB, LR, RL, BT): nodes `id`, `id[text]`, `id(text)`, `id{text}`, `id((text))`, `id([text])`; edges `-->`, `---`, `-.->`, `==>` with an optional `|label|` or `-- label -->`; `subgraph name … end` as a group; chains `a --> b --> c`.
- `sequenceDiagram`: `participant`/`actor` (with `as`), messages `->>`, `-->>`, `->`, `-->`, `-x`, notes as labelled nodes; `alt/loop/opt` blocks are flattened with a warning.
- `mindmap`: indentation tree with `root((text))` and plain nodes.
- `timeline`: `title`, `section`, `period : event : event`.
- `classDiagram` and `erDiagram` (lite): classes and entities with their member lines as text, relationships with a label and cardinality text.

Everything else (styling directives, `click`, themes, `%%{init}%%`, other diagram kinds) is skipped with `FLX_IMPORT_UNSUPPORTED` (warning, with line and column) so the rest still imports; the codes are added to `DslCode`/`DSL_CODES` in `packages/dsl/src/diagnostics/codes.ts` (which generates the diagnostics docs table) in M15.16, pinned by the codes test; a source with no supported kind is an error `FLX_IMPORT_UNKNOWN_KIND`. Syntax errors inside a supported kind are `FLX_IMPORT_SYNTAX` errors with position. The mapping uses the basic shapes and the layout engine; positions are never invented, the `layered` layout places a flowchart, `tree` places a mindmap, sequence and timeline use a small fixed lane layout declared in the emitted FluxScript.

**Markdown.** `mdast-util-from-markdown` parses; the importer reads headings and lists only: a level-1 heading is the deck title and opens the first screen, each level-2 heading or `---` rule starts a screen, its paragraphs and list items become text nodes, nested lists become a tree with edges, a fenced code block becomes a code-style text node, except a fenced `mermaid` block, which goes through the Mermaid importer and becomes a diagram screen, and images become image nodes with the alt text kept. Raw HTML, tables, footnotes and anything else is `FLX_IMPORT_UNSUPPORTED`. No inline markup is interpreted beyond plain text.

**Dependency.** `mdast-util-from-markdown` is a runtime dependency of `@fluxion/dsl` only (not of the player, which does not import `@fluxion/dsl`); its licence and its transitive set are checked by `check-licenses` in M15.17. `mermaid` is not a dependency.

**The transitive DOM entry.** `mdast-util-from-markdown` reaches `decode-named-character-reference`, whose `browser` export condition resolves to an `index.dom.js` that calls `document.createElement` when the module loads. `@fluxion/dsl`'s own sources touch no DOM (`check-layering` scans them), but a browser bundle would load that entry, which fails in a worker or a server render. The studio's Vite config therefore aliases the package to its plain `index.js` (same table, no DOM); M15.17 adds the alias and a test that `importMarkdown` runs in the node project and, through the alias, in the browser project.

### Consequences

- Good: pure, deterministic, tiny; works in Node, tests and the studio; every omission is reported.
- Good: output flows through compile, layout and lint, so an imported diagram is validated like an authored one.
- Bad: a Mermaid file outside the subset imports partially; the diagnostics say what was dropped, and the subset is documented.
- Bad: the parsers must be maintained by us as Mermaid grows; the supported list is the contract, extended by backlog rows.
- Bad: one new dependency tree (micromark family) in `@fluxion/dsl`.

### Confirmation

M15.16 (Mermaid fixtures per kind compile, validate and render; a golden pins the FluxScript; unsupported input gives the codes above), M15.17 (Markdown fixtures, the dependency licence check).

## More Information

FR-DSL-007, FR-IMP-001, 06-ai-authoring.md §3 (the DSL), docs/standards diagnostics, AGENTS.md rule 5 and 8.
