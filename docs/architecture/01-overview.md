# 01 — Architecture Overview

> Read when: starting any work, adding a package, adding a dependency, or unsure where code belongs.
> Research basis: `docs/research/01`–`06`. Decisions: `decisions/`.

## 1. System context (C4 level 1)

```
                ┌────────────────────┐        MCP / CLI / JSON         ┌───────────────────┐
  AI agent ────▶│  @fluxion/mcp      │◀──────────────────────────────▶│  Claude / Codex /  │
  (external)    │  @fluxion/cli      │                                 │  any LLM client    │
                └─────────┬──────────┘                                 └───────────────────┘
                          │ uses headless packages (Node ≥ 22)
                          ▼
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ Fluxion libraries: schema · core · layout · routing · anim · format · dsl · render · player │
└───────────────────────────────────────────────────────────────────────────────────────────┘
                          ▲                                   ▲
                          │ bundled into                      │ embedded (player only) into
                ┌─────────┴──────────┐                ┌───────┴──────────────┐
  Author ──────▶│ apps/studio (PWA)  │── save ──────▶ │ deck.flux.html       │◀── Viewer / Presenter
                │ editor + player    │◀── open ────── │ deck.flux (zip)      │    (any browser, offline)
                └────────────────────┘                └──────────────────────┘
                                                      └──▶ static site / PDF / PNG / SVG / PPTX
```

## 2. Package map (containers & components)

All packages live in a pnpm + Turborepo monorepo. `@fluxion/*` names; folders under `packages/`.

| Layer | Package | Responsibility | May depend on | Pure? |
|---|---|---|---|---|
| L0 | `schema` | Zod 4 schemas & TS types for every record; IDs; validation errors; JSON Schema generation; migrations | — (zod) | ✅ |
| L0 | `geometry` | Vectors, matrices, bezier/path ops, outline sampling, intersections, bounding boxes, spatial index (rbush/flatbush wrappers) | — | ✅ |
| L1 | `core` | Document store (records + signals), transactions, commands, undo/redo, queries, registries (kinds, defs, routers, layouts, effects…), bindings resolution | schema, geometry | ✅ |
| L1 | `theme` | Token model (DTCG), token resolution, palette generation (OKLCH/culori), contrast checks, CSS-variable emission | schema | ✅ |
| L2 | `layout` | Layout interface + built-in algorithms, worker host, constraint/overlap pass, text-measure port | core, geometry | ✅ (worker glue isolated in `layout/worker`) |
| L2 | `routing` | Router interface, straight/bezier/orthogonal A* router, anchor selection, nudging, hops, label placement | schema, core, geometry | ✅ |
| L2 | `anim` | Animation/timeline/interaction **model evaluation**: sampling effects at time t, build-state reduction, morph interpolation, rider LUTs, expression interpreter | core, geometry, theme | ✅ (clock injected) |
| L2 | `format` | `.flux` zip / `.flux.html` / `.flux.json` read & write, asset store (content addressing), sanitizers, lockfile | schema, core | ✅ (I/O via ports) |
| L2 | `dsl` | FluxScript parser, compiler, decompiler, diagnostics, Mermaid/Markdown importers | schema, core, layout (for compile-time layout), theme | ✅ |
| L3 | `render` | React 19 DOM+SVG renderer of a screen: element views, shape/connector/rider views, CSS variables, measurement adapter; **identical in edit & present** | schema, core, theme, anim, geometry, routing | DOM |
| L4 | `player` | Present runtime: navigation, clock & scheduler, transition manager, trigger bus, interaction engine, overlays, responsive, speaker sync, `<fluxion-player>` web component | render, anim, format, core, schema | DOM |
| L4 | `editor` | Edit overlay (selection, handles, guides), tools state machine, panels, inspector, library, timeline & interaction editors, AI panel | render, player, core, layout, routing, format, dsl, theme, geometry, schema | DOM |
| L4 | `sdk` | Public plugin API (re-exports stable contracts), manifest schema, component contract, test harness | core, render (types), schema | — |
| L5 | `cli` | `fluxion` command: validate, compile, render, lint, layout, convert, catalog, pack, site build | schema, format, dsl, layout, routing, anim, render (SSR), sdk, basic (bundled pack, ADR-0017) | Node |
| L5 | `mcp` | MCP server over the same operations as the CLI | cli internals (`ops`), format, dsl | Node |
| L5 | `exporters` (R7) | PDF/PNG/SVG/PPTX/video/site | render, player, format | mixed |
| App | `apps/studio` | Vite PWA: editor + player shell, file handling, provider adapters | editor, player, core, schema, basic (bundled pack, ADR-0017) | DOM |
| App | `apps/docs` | Astro Starlight docs site, llms.txt | — | — |
| Packs | `packs/*` | First-party plugins: `basic`, `flowchart`, `arrows`, `uml`, `bpmn-lite`, `network`, `icons-lucide`, `themes-core`, `effects-core`, `layouts-elk` (optional), `routing-libavoid` (optional) | sdk | — |

### Dependency rules (enforced by `dependency-cruiser`, gate `check-layering`)

1. A package may only import from **lower layers** (L0 < L1 < … < L5 < App) or its own layer when listed above.
2. `schema`, `geometry`, `core`, `theme`, `layout`, `routing`, `anim`, `format`, `dsl` are **pure**: no `window`, `document`, DOM types, `setTimeout`, `Date.now`, `Math.random`, `fetch`, or `node:*` imports. Time, randomness, I/O, and text measurement come in through **ports** (interfaces) injected by callers.
3. `player` must never import `editor`. The saved file embeds the player only.
4. `packs/*` import only `@fluxion/sdk` (and allowed peer libs). First-party code has no private back doors ("dogfooding rule", FR-EXT-001).
5. No package imports from another package's internal paths — only its `exports` entry points.

## 3. Key runtime architecture

```
                        ┌────────────── core (pure) ──────────────┐
  commands ──▶ tx ──▶   │ RecordStore (Map<id, record>)            │──▶ diff (puts/deletes) ──▶ undo stack
  (editor/AI/DSL)       │ signals: record$, query$ (alien-signals)  │                           autosave
                        │ registries: kinds, defs, routers, …      │                           (future CRDT)
                        └──────────────┬──────────────────────────┘
                                       │ derived signals (resolved styles, geometry, routes)
                        ┌──────────────▼──────────────┐
                        │ render: <ScreenView>         │  one renderer → both modes
                        │  layers: background, content │
                        │  (shapes, connectors),       │
                        │  riders canvas, overlays     │
                        └───────┬───────────────┬──────┘
                    present     │               │ edit
               ┌────────────────▼───┐   ┌───────▼──────────────────────┐
               │ player: clock,     │   │ editor: overlay layer (SVG),  │
               │ scheduler, trigger │   │ tools FSM, hit-test (rbush),  │
               │ bus, transitions   │   │ inspector, panels, preview    │
               └────────────────────┘   │ uses player with controlled   │
                                        │ clock for animation preview   │
                                        └───────────────────────────────┘
```

- **One renderer, two modes** (FR-EDT-010): the editor never re-implements drawing. Edit chrome
  is an overlay in screen coordinates on top of the same `<ScreenView>`.
- **Derived data is computed, not stored**: resolved styles (theme tokens), connector routes,
  anchor positions, layout results in live containers. Baked values are stored only where
  portability demands (e.g., laid-out positions, optional route cache for exports).
- **Everything time-based samples a pure function of (model, t)** so deep links, reverse steps,
  edit-mode scrubbing and exports are exact (research 03 §Recommendation).

## 4. Technology stack (decided)

Details, versions and rationale: `docs/standards/tech-stack.md`. Summary:

| Concern | Choice |
|---|---|
| Language | TypeScript (strict), ESM only |
| Runtime targets | Evergreen browsers; Node ≥ 22 LTS for CLI/MCP |
| Monorepo | pnpm workspaces + catalogs, Turborepo |
| Build | Vite 8 (apps), tsdown (libraries), `vite-plugin-singlefile` pattern for player bundle |
| Typecheck | `tsc -b` project references (TS 7 native for speed; TS 6 kept for API tooling until TS 7.1) |
| Lint/format | Biome 2 (lint + format) + dependency-cruiser + knip + size-limit + publint |
| UI framework | React 19 (+ React Compiler) |
| Doc state | Own record store in `core` with `alien-signals` reactivity |
| Editor UI state | core signals in a per-document session (ADR-0028) |
| Schema | Zod 4 (+ `z.toJSONSchema`) |
| Editor chrome UI | shadcn/ui on Base UI + Tailwind v4 (editor only; never in rendered content) |
| Content styling | CSS custom properties from theme tokens + content CSS strings, `fx-` prefix, `@layer fx.content` (ADR-0015) |
| Animation | Own scheduler + WAAPI for compositor properties; flubber (morph); d3-interpolate-path (routes); Motion for editor/overlay UI |
| Layout | Own grid/stack/timeline/templates; @dagrejs/dagre (layered, default); d3-hierarchy + d3-flextree (tree/mindmap); d3-force (force); WebCola (constraints/overlap); elkjs (optional pack, lazy worker, EPL) |
| Routing | Own A* orthogonal sparse-grid router + nudging; libavoid-js (optional pack, LGPL, wasm) |
| Text measurement | Port interface; browser: canvas `measureText` + DOM verify; Node: fontkit-based measurer |
| File container | fflate (zip/deflate), SubtleCrypto SHA-256, `DecompressionStream` bootstrap in HTML |
| DSL parsing | `yaml` (source ranges) + small hand-written edge-shorthand parser |
| Testing | Vitest (unit, browser mode), fast-check, Playwright (E2E, visual, a11y via axe), Storybook (editor UI), tzap mutation testing (ADR-0146) |
| Docs | Astro Starlight, TypeDoc, API Extractor, MADR ADRs, llms.txt |
| CI/CD | GitHub Actions, Changesets, Renovate, CodeQL, OSV-Scanner, Cloudflare preview deploys |
| i18n | Lingui (ICU) |
| MCP | `@modelcontextprotocol/sdk` (stdio + streamable HTTP) |

## 5. Architectural decisions index

| ADR | Decision |
|---|---|
| [0001](decisions/ADR-0001-own-engine-dom-svg.md) | Build own engine on React DOM+SVG; do not build on tldraw/xyflow/JointJS |
| [0002](decisions/ADR-0002-record-store-signals.md) | Normalized record store + signals + record-diff undo; CRDT-ready |
| [0003](decisions/ADR-0003-file-format.md) | `.flux` zip + `.flux.html` self-contained player + `.flux.json` |
| [0004](decisions/ADR-0004-fluxscript-dsl.md) | FluxScript YAML-shaped DSL; AI never computes coordinates |
| [0005](decisions/ADR-0005-layout-routing-stack.md) | Pluggable layout/routing pipeline; permissive-licensed defaults; ELK/libavoid optional |
| [0006](decisions/ADR-0006-own-animation-model.md) | Own declarative animation model & scheduler; sample(model, t) |
| [0007](decisions/ADR-0007-plugin-trust-model.md) | Plugin manifest, import-map shared deps, iframe sandbox for untrusted |
| [0008](decisions/ADR-0008-toolchain.md) | pnpm/Turbo/Vite/tsdown/Biome/Vitest/Playwright toolchain |
| [0009](decisions/ADR-0009-ai-harness.md) | AGENTS.md + portable skills + /goal-driven milestone loop with hash-bound review |
| [0010](decisions/ADR-0010-styling-isolation.md) | Tailwind for editor chrome only; tokens + CSS modules for content |
