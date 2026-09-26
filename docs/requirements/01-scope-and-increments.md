# 01 — Scope and Increments

## 1. Vision

Fluxion is a TypeScript platform to **author, generate, and present interactive, animated
diagram-screens** — as full-screen presentations, mobile-friendly views, or static info sites —
saved as a **single portable file**. AI is the primary author; humans refine visually.

Deliverables (packages, see architecture):

| Deliverable | Description |
|---|---|
| `@fluxion/schema` | Document types, validation, JSON Schema, migrations |
| `@fluxion/core` | Headless document engine: store, commands, undo, geometry, queries |
| `@fluxion/render` | React renderer shared by player and editor |
| `@fluxion/player` | Present runtime (navigation, animation, interaction, responsive) |
| `@fluxion/editor` | Editing UI and tools on top of render + core |
| `@fluxion/layout` / `@fluxion/routing` | Layout and connector routing engines |
| `@fluxion/format` | Single-file read/write (HTML + compressed payload), assets |
| `@fluxion/dsl` | AI/human authoring DSL → document compiler |
| `@fluxion/sdk` | Plugin SDK and contribution APIs |
| `@fluxion/cli` | Validate, compile, build, export, pack |
| `@fluxion/mcp` | MCP server exposing document tools to AI agents |
| `apps/studio` | Web app (PWA) — editor + player |
| `packs/*` | First-party shape/connector/theme/layout packs |

## 2. Increments

Each increment is a shippable, demoable product state. Milestones (in `../milestones`) break
increments into ≤ ~20-task chunks.

| Inc | Name | Theme | Demo at exit |
|---|---|---|---|
| **R0** | Foundation | Repo, harness, schema, headless core, static render | CLI renders a JSON doc with rectangles & straight lines to an HTML file |
| **R1** | MVP Editor & Player | Basic shapes, connectors, text, select/move/resize, undo, basic theme, present mode, single-file save/open | Create a 5-screen deck by hand, save one `.flux.html`, reopen, present full-screen |
| **R2** | AI Authoring v1 | DSL, JSON Schema, validate+repair, basic auto layout, CLI, MCP server | An LLM produces a valid 10-screen deck from a prompt via MCP; opens in editor |
| **R3** | Diagram Power | Anchors, orthogonal routing, full layout suite, shape library + import, group/align/snap | Architecture diagram with 60 nodes auto-laid-out, no overlaps, orthogonal connectors |
| **R4** | Motion | Animation effects, build timelines, transitions, morph, connector flows, riders | "Power grid" screen: electrons flow along lines, nodes pulse, magic-move between screens |
| **R5** | Interactivity | Triggers/actions, popups, drill-down zoom, states/variables, speaker view | Clickable system map: click node → popup detail → zoom into sub-diagram → back |
| **R6** | Extensibility | Plugin SDK, React component elements, packs, embedding plugins in file, sandbox | Third-party pack (shapes + React chart component + layout) installed & embedded in a file |
| **R7** | Reach & Publish | Mobile/responsive, static site mode, exports (PDF/PNG/SVG/PPTX), importers | Same doc as desktop deck, mobile portrait view, and multi-page static site |
| **R8** | 1.0 Hardening | A11y, performance, i18n, security review, docs site, API freeze | Public 1.0 release with docs, examples, and stable file format v1 |

### Exit criteria common to every increment
1. All `M` requirements of the increment implemented with passing tests traced by ID.
2. CI green on main; visual-regression baseline updated & reviewed.
3. Docs updated (user guide + API reference for touched packages); CHANGELOG via changesets.
4. A demo document for the increment committed under `examples/` and rendered in CI.
5. File format changes accompanied by a migration and a round-trip test.

## 3. In scope (overall)
- Browser-based editor & player (Chromium, Firefox, Safari — current and previous major).
- Desktop full-screen presentation and mobile (phone/tablet) viewing.
- Local-first persistence (file, IndexedDB autosave); static hosting.
- AI generation through DSL, JSON, CLI and MCP.
- Plugin ecosystem with first-party packs.

## 4. Out of scope (v1)
- Real-time multi-user collaboration (model stays CRDT-compatible — `NFR-MNT-006`).
- User accounts, cloud storage, marketplace backend.
- Native mobile apps; desktop wrapper (Tauri) is post-1.0.
- Built-in LLM hosting — Fluxion calls external providers via adapters or is driven by external agents.
