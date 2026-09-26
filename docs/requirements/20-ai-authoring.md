# 20 — AI Authoring (DSL, Schema, CLI, MCP, Generation)

Areas: `AI` (generation pipeline), `DSL` (authoring language), `CLI`, `MCP`.

Principle: **the AI expresses intent, the engine computes geometry.** An LLM should never need
to compute coordinates; it names shapes, relations, layout intent, theme variants, and motion,
and Fluxion lays out, routes, and styles deterministically.

## DSL — Authoring language

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-DSL-001 | M | R2 | A compact text **authoring DSL — FluxScript** (`*.flux.yaml`; YAML 1.2-shaped with an edge shorthand `a -> b: label`; grammar in `../architecture/06-ai-authoring.md`) that compiles to the canonical document. | Grammar tests; every example in docs compiles. |
| FR-DSL-002 | M | R2 | DSL expresses: document meta, theme (name/overrides), screens (title, layout intent, background), elements (kind/defId, label/text, variant, semantic data), connections (`a -> b : label`, route type, style), groups/containers, layout per container. | Round-trip test: DSL → doc → DSL is semantically equal. |
| FR-DSL-003 | M | R4 | DSL expresses builds/animations (`step: fade-in a, b`), transitions, riders (`a -> b { riders: electron x5 }`), flows. | Examples compile with correct timelines. |
| FR-DSL-004 | M | R5 | DSL expresses interactions (`on click a: popup detail-a`) and variables. | Examples compile. |
| FR-DSL-005 | M | R2 | Optional coordinates: when positions are omitted the compiler runs layout; when provided they are respected (pinned). | Mixed fixture: pinned stay, others laid out. |
| FR-DSL-006 | M | R2 | Errors carry line/col, message, and a **suggested fix** (did-you-mean for unknown shape/token ids, missing refs). | Error snapshots include suggestions. |
| FR-DSL-007 | S | R2 | Importers: Mermaid (flowchart, sequence-lite, mindmap, timeline, class/ER lite) and Markdown outline → DSL/doc. | Mermaid fixtures compile & render. |
| FR-DSL-008 | S | R3 | Decompiler: doc → DSL (lossy parts emitted as raw JSON escape blocks). | Idempotence on compile(decompile(doc)). |
| FR-DSL-009 | S | R2 | Language tooling: TextMate grammar/syntax highlight, Monaco/CodeMirror language support with completion of shape ids, tokens, element refs. | Completion lists pack shapes. |

## AI — Generation pipeline & schema

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-AI-001 | M | R2 | Publish **JSON Schema** of the document and of an "AI patch" format generated from the source types (single source of truth). | Schema generated in build; drift test. |
| FR-AI-002 | M | R2 | **AI catalog**: machine-readable, token-efficient listing of available shape ids, connector types, layouts, themes, effects, components with one-line descriptions & params (`fluxion catalog --format=llm`). Generated from registries. | Catalog includes plugin contributions. |
| FR-AI-003 | M | R2 | **Patch operations** for incremental AI edits: add/update/remove elements, connect, set layout, restyle, add step — addressable by ID or semantic label; applied atomically. | Patch fixtures apply; invalid patch rejected with errors. |
| FR-AI-004 | M | R2 | **Validate-repair loop**: validation output formatted for LLM consumption (compact, ranked, with fix hints) so the agent can self-correct. | Eval: ≥ 99 % valid after one repair round (NFR-AI-001). |
| FR-AI-005 | M | R2 | **Quality linter** beyond schema: overlap, off-screen, text overflow, low contrast, too much text per screen, orphan connectors, inconsistent styling; severity + fix hints. | Lint fixtures. |
| FR-AI-006 | S | R2 | Render-to-image for AI visual self-check (PNG per screen via headless browser in CLI; in-browser via SVG serialization). | `fluxion render --png` produces images. |
| FR-AI-007 | S | R2 | Provider adapters (optional, in studio): Anthropic, OpenAI, OpenAI-compatible/local; user-supplied keys stored locally only; prompt templates versioned in repo. | Keys never included in saved file (test). |
| FR-AI-008 | S | R4 | Generation modes: from prompt, from outline/markdown, from source document (text/PDF extract), "restyle", "animate this screen", "make portrait variant", "explain this diagram as build steps". | Each mode has eval cases. |
| FR-AI-009 | M | R2 | **Eval suite**: versioned prompts → expected properties (validity, lint score, screen count, element types); runnable in CI with recorded responses and live on demand. | `pnpm eval` produces a scorecard. |
| FR-AI-010 | S | R2 | Streaming/progressive generation: screens render as they arrive (DSL is line-oriented & streamable). | Partial DSL renders complete screens so far. |
| FR-AI-011 | M | R2 | `llms.txt` + AI authoring guide generated into docs site and embedded in MCP resources. | Present in build output. |

## CLI

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-CLI-001 | M | R0 | `fluxion` CLI (Node ≥ 22): `validate`, `render`(html) in R0. | CLI e2e tests. |
| FR-CLI-002 | M | R2 | Commands: `compile` (DSL→file), `decompile`, `validate`, `lint`, `layout`, `render` (html/png/svg/pdf), `catalog`, `migrate`, `convert` (flux ⇄ flux.html ⇄ flux.json), `patch`. JSON output mode (`--json`) for agents. | Each command e2e; `--json` schema-stable. |
| FR-CLI-003 | M | R6 | Plugin commands: `plugin create`, `pack`, `plugin validate`. | E2E. |
| FR-CLI-004 | S | R7 | `site build`: static info-site from doc(s). | See FR-SITE. |
| FR-CLI-005 | M | R2 | Exit codes: 0 ok, 1 validation errors, 2 usage error, 3 internal error. | Tests. |

## MCP — Model Context Protocol server

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-MCP-001 | M | R2 | `@fluxion/mcp` server (stdio + streamable HTTP) exposing tools: `create_document`, `get_document_outline`, `get_screen`, `apply_patch`, `compile_dsl`, `validate`, `lint`, `layout`, `render_screen_png`, `list_catalog`, `save_file`. | MCP inspector tests; example session with Claude Code & Codex. |
| FR-MCP-002 | M | R2 | Resources: authoring guide, schema, catalog, examples. Prompts: `generate_deck`, `diagram_from_description`, `animate_screen`. | Listed by client. |
| FR-MCP-003 | S | R5 | Live link: MCP server can connect to an open studio tab (local WebSocket) so an agent edits the live document with undo integration. | Agent patch appears live, undoable. |
