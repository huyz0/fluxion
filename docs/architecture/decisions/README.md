# Architecture Decision Records

> Read when: making or questioning a decision that is expensive to reverse, or when a change
> touches anything listed under "ADR required when" below.

Format: [MADR 4](https://adr.github.io/madr/): YAML front matter (`status`, `date`,
`decision-makers`), then *Context and Problem Statement*, *Decision Drivers*, *Considered Options*,
*Decision Outcome* (with *Consequences* and *Confirmation*), *Pros and Cons of the Options*,
*More Information*. Copy the structure of any accepted ADR below as the template. The `adr` skill
(`.agents/skills/adr/`) walks through it.

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](ADR-0001-own-engine-dom-svg.md) | Build our own engine on React DOM + SVG | accepted | 2026-09-26 |
| [0002](ADR-0002-record-store-signals.md) | Normalized record store with signals and record-diff undo | accepted (editor UI state: superseded by 0028) | 2026-09-26 |
| [0003](ADR-0003-file-format.md) | `.flux` zip + `.flux.html` self-contained player + `.flux.json` | accepted | 2026-09-26 |
| [0004](ADR-0004-fluxscript-dsl.md) | FluxScript YAML-shaped DSL; AI never computes coordinates | accepted | 2026-09-26 |
| [0005](ADR-0005-layout-routing-stack.md) | Pluggable layout/routing pipeline; permissive defaults; ELK/libavoid optional | accepted | 2026-09-26 |
| [0006](ADR-0006-own-animation-model.md) | Own declarative animation model and scheduler | accepted | 2026-09-26 |
| [0007](ADR-0007-plugin-trust-model.md) | Plugin manifest, import-map shared deps, iframe sandbox for untrusted code | accepted | 2026-09-26 |
| [0008](ADR-0008-toolchain.md) | pnpm 11 / Turborepo / Vite 8 / tsdown / tsgo / Biome 2 / Vitest / Playwright / Storybook / Changesets | accepted | 2026-09-26 |
| [0009](ADR-0009-ai-harness.md) | AGENTS.md + portable skills + goal-driven milestone loop + hash-bound cross-vendor review | accepted | 2026-09-26 |
| [0010](ADR-0010-styling-isolation.md) | Tailwind/shadcn for editor chrome only; tokens + `fx-` content CSS for content (amended by 0015: CSS strings, `@layer fx.content`; by 0029: chrome Tailwind from M7, no preflight) | accepted | 2026-09-26 |
| [0011](ADR-0011-source-resolution-dual-compiler.md) | Workspace source resolution (`@fluxion/source` condition) and dual TypeScript compiler (TS 7 check, TS 6 for TypeDoc and dependency-cruiser) | accepted | 2026-09-26 |
| [0012](ADR-0012-ids-and-fractional-indices.md) | Record IDs and fractional-index keys are own code in `@fluxion/schema` | accepted | 2026-09-27 |
| [0013](ADR-0013-rich-text-subset.md) | Rich text is a ProseMirror-compatible JSON subset validated by Zod | accepted | 2026-09-27 |
| [0014](ADR-0014-command-and-transaction-semantics.md) | Command and transaction semantics of the record store (Result-returning transactions, fixed-point hooks, merge adjacency, inverse-diff undo, snapshot forks) | accepted | 2026-09-28 |
| [0015](ADR-0015-static-render-path.md) | Static render path: `<ScreenView>` through `react-dom/server`, content CSS as an inlined string, styles resolved in `theme` | accepted | 2026-09-28 |
| [0016](ADR-0016-shape-outlines-and-expressions.md) | Shape outlines as path templates, and a safe expression language | accepted | 2026-09-29 |
| [0017](ADR-0017-hosts-bundle-first-party-packs.md) | Hosts bundle first-party packs as listed dependencies (packs at rank 5) | accepted | 2026-09-29 |
| [0018](ADR-0018-shape-text-fitting.md) | Shape text fitting: an optional `textFit` on shapes, pure layout in core | accepted | 2026-09-29 |
| [0019](ADR-0019-stroke-alignment-and-corner-radius.md) | Stroke alignment and corner radius on any outline | accepted | 2026-09-29 |
| [0020](ADR-0020-clipboard-format.md) | The clipboard format: one versioned Fluxion payload in every representation each path allows | accepted | 2026-10-01 |
| [0028](ADR-0028-editor-interaction-architecture.md) | Editor interaction: statechart tools, a signal session store, a screen-space SVG overlay, a frame-batched pointer pipeline | accepted | 2026-09-30 |
| [0029](ADR-0029-editor-chrome-primitives.md) | Editor chrome: own splitters, a scoped `@layer fx.chrome` stylesheet, the panel layout in a settings port (amends 0010's timing) | accepted | 2026-09-30 |
| [0064](ADR-0064-rich-text-editor-library.md) | The rich-text editor library is ProseMirror, used directly and loaded with the editor only | accepted | 2026-10-01 |
| [0137](ADR-0137-subagent-review-no-dry-runs.md) | Isolated-subagent review by default; `/goal` dry runs not required (supersedes part of 0009) | accepted | 2026-09-26 |
| [0138](ADR-0138-pnpm-run-setup.md) | Invoke the repository setup script as `pnpm run setup` | accepted | 2026-09-26 |
| [0139](ADR-0139-storybook-portable-stories.md) | Story tests through portable stories until `@storybook/addon-vitest` supports Vitest 5 | accepted | 2026-09-27 |
| [0140](ADR-0140-record-types-checked-against-schemas.md) | Record types are written once as TSDoc'd types and checked against their Zod schemas | accepted | 2026-09-27 |
| [0141](ADR-0141-spatial-index-rbush-flatbush.md) | Spatial index: `rbush` and `flatbush` behind one `SpatialIndex` interface | accepted | 2026-09-27 |
| [0142](ADR-0142-parsing-never-fills-defaults.md) | Parsing a document never fills in defaults; readers apply documented defaults | accepted | 2026-09-27 |
| [0143](ADR-0143-ci-cold-setup-authority.md) | Inside CI the cold-setup job is the cold-setup authority; locally the recorded budget is | accepted | 2026-09-28 |
| [0144](ADR-0144-one-result-convention.md) | One Result shape across pure packages; each package owns its error-code union | accepted | 2026-09-28 |
| [0145](ADR-0145-budget-refresh-without-local-cold-setup.md) | A lockfile commit records a pending cold setup; CI's measurement replaces it after the push | accepted | 2026-09-28 |
| [0146](ADR-0146-mutation-testing-tzap.md) | Mutation testing with tzap instead of StrykerJS | accepted | 2026-09-28 |
| [0147](ADR-0147-cli-v0-contract.md) | CLI v0: command shape, exit codes and the `--json` envelope | accepted | 2026-09-29 |
| [0148](ADR-0148-text-measurement-from-recorded-metrics.md) | Text is measured from font metrics recorded from the engine that draws it | accepted | 2026-10-02 |

## ADR required when

A change needs a new ADR, or a superseding one, in the **same commit** when it:

1. Changes a row of the decided stack in `docs/standards/tech-stack.md`, or adds a runtime
   dependency to `player` or anything it bundles.
2. Changes the file format: container layout, `formatVersion`, a **major** `schemaVersion`, or
   what is baked vs derived (08).
3. Makes a breaking change to a `@public` API of `@fluxion/sdk` or another published package
   (NFR-MNT-007).
4. Changes the layering or dependency rules in `01-overview.md` §2, or makes a pure package
   impure.
5. Changes the plugin trust model, sandbox, CSP or any security boundary (NFR-SEC-*).
6. Changes FluxScript grammar incompatibly, the AI patch format, CLI exit codes or `--json` shapes,
   or MCP tool contracts.
7. Adds a copyleft (EPL/LGPL/MPL-modified) component or changes licence policy (NFR-LIC-*).
8. Edits `docs/requirements/` acceptance criteria (the harness forbids this without an ADR).
9. Weakens a threshold in `scripts/gates/thresholds.mjs` (normally forbidden; an ADR is the only
   route).

## Lifecycle

`proposed` → `accepted` → (`deprecated` | `superseded by ADR-NNNN`). ADRs are never edited in
substance after acceptance. Write a new ADR that supersedes the old one, then update the old
one's status line and this index.
