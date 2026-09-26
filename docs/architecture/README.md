# Fluxion Architecture

> Read when: you need to know *how* Fluxion is built and which document to open before changing
> a package. *What* it must do is in [`../requirements`](../requirements). *How we work* is in
> [`../standards`](../standards). The evidence behind the choices is in [`../research`](../research).

Documents are numbered in reading order. 01 is mandatory for any work. After that, read only the
docs whose "Read when" matches your change.

## Documents

| # | Document | Read when | Main packages |
|---|---|---|---|
| 01 | [Overview](01-overview.md) | starting any work, adding a package or dependency, unsure where code belongs | all |
| 02 | [Document model](02-document-model.md) | touching `@fluxion/schema`, adding a record type or field, writing a migration, generating documents | `schema` |
| 03 | [Core engine](03-core-engine.md) | touching the store, commands, undo, registries, geometry, hit-testing, or adding any mutation path | `core`, `geometry` |
| 04 | [Rendering and editor](04-rendering-and-editor.md) | changing `<ScreenView>`, element views, render layers, the editor overlay, tools, panels or inspector | `render`, `editor` |
| 05 | [Layout and routing](05-layout-and-routing.md) | changing layout algorithms, the layout pipeline or worker, anchors, routers, nudging or label placement | `layout`, `routing` |
| 06 | [AI authoring](06-ai-authoring.md) | changing FluxScript, compiler/decompiler, diagnostics, AI patches, catalog, lint rules, generation pipeline, CLI, MCP, provider adapters or evals | `dsl`, `cli`, `mcp` |
| 07 | [Animation and interaction](07-animation-and-interaction.md) | changing the animation model, scheduler, transitions, morph, riders, triggers/actions or the player runtime | `anim`, `player` |
| 08 | [File format](08-file-format.md) | changing what is saved or loaded, containers, the asset pipeline, save/open/autosave, loader robustness, or file security | `format` |
| 09 | [Extensibility](09-extensibility.md) | adding a contribution point, writing or loading plugins/packs, changing the SDK, component contract or trust model | `sdk`, `packs/*` |
| 10 | [Responsive and publishing](10-responsive-and-publishing.md) | working on responsive modes, breakpoints, portrait variants, touch, static sites, exporters or importers | `player`, `exporters`, `cli` |

## Architecture decision records

Index, template and the "ADR required when" list: [`decisions/README.md`](decisions/README.md).

| ADR | Decision |
|---|---|
| [0001](decisions/ADR-0001-own-engine-dom-svg.md) | Own engine on React DOM + SVG; no tldraw/xyflow/JointJS foundation |
| [0002](decisions/ADR-0002-record-store-signals.md) | Normalized record store + alien-signals + record-diff undo; CRDT-ready |
| [0003](decisions/ADR-0003-file-format.md) | `.flux` zip + `.flux.html` self-contained player + `.flux.json` |
| [0004](decisions/ADR-0004-fluxscript-dsl.md) | FluxScript YAML-shaped DSL; AI never computes coordinates |
| [0005](decisions/ADR-0005-layout-routing-stack.md) | Pluggable layout/routing pipeline; permissive defaults; ELK/libavoid optional |
| [0006](decisions/ADR-0006-own-animation-model.md) | Own declarative animation model and scheduler; `sample(model, t)` |
| [0007](decisions/ADR-0007-plugin-trust-model.md) | Plugin manifest, import-map shared deps, iframe sandbox for untrusted code |
| [0008](decisions/ADR-0008-toolchain.md) | pnpm 11 / Turborepo / Vite 8 / tsdown / tsgo / Biome 2 / Vitest / Playwright / Storybook / Changesets |
| [0009](decisions/ADR-0009-ai-harness.md) | AGENTS.md + portable skills + goal-driven milestone loop + hash-bound cross-vendor review |
| [0010](decisions/ADR-0010-styling-isolation.md) | Tailwind/shadcn for editor chrome only; theme tokens + CSS Modules for content |

## Conventions for architecture docs

- Every doc starts with `> Read when: …` and stays within 120–280 lines. Depth lives in research
  docs, which the architecture docs link to.
- TypeScript interface sketches are **contracts in intent**. The source of truth is the code in the
  named package, and a change to a sketched contract updates the doc in the same commit.
- Requirement IDs (`FR-…`, `NFR-…`) are cited wherever a design choice exists to satisfy one.
- A change that meets any "ADR required when" condition ships with its ADR.
