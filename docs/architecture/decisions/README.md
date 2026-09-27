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
| [0002](ADR-0002-record-store-signals.md) | Normalized record store with signals and record-diff undo | accepted | 2026-09-26 |
| [0003](ADR-0003-file-format.md) | `.flux` zip + `.flux.html` self-contained player + `.flux.json` | accepted | 2026-09-26 |
| [0004](ADR-0004-fluxscript-dsl.md) | FluxScript YAML-shaped DSL; AI never computes coordinates | accepted | 2026-09-26 |
| [0005](ADR-0005-layout-routing-stack.md) | Pluggable layout/routing pipeline; permissive defaults; ELK/libavoid optional | accepted | 2026-09-26 |
| [0006](ADR-0006-own-animation-model.md) | Own declarative animation model and scheduler | accepted | 2026-09-26 |
| [0007](ADR-0007-plugin-trust-model.md) | Plugin manifest, import-map shared deps, iframe sandbox for untrusted code | accepted | 2026-09-26 |
| [0008](ADR-0008-toolchain.md) | pnpm 11 / Turborepo / Vite 8 / tsdown / tsgo / Biome 2 / Vitest / Playwright / Storybook / Changesets | accepted | 2026-09-26 |
| [0009](ADR-0009-ai-harness.md) | AGENTS.md + portable skills + goal-driven milestone loop + hash-bound cross-vendor review | accepted | 2026-09-26 |
| [0010](ADR-0010-styling-isolation.md) | Tailwind/shadcn for editor chrome only; tokens + CSS Modules for content | accepted | 2026-09-26 |
| [0011](ADR-0011-source-resolution-dual-compiler.md) | Workspace source resolution (`@fluxion/source` condition) and dual TypeScript compiler (TS 7 check, TS 6 for TypeDoc and dependency-cruiser) | accepted | 2026-09-26 |
| [0012](ADR-0012-ids-and-fractional-indices.md) | Record IDs and fractional-index keys are own code in `@fluxion/schema` | accepted | 2026-09-27 |
| [0137](ADR-0137-subagent-review-no-dry-runs.md) | Isolated-subagent review by default; `/goal` dry runs not required (supersedes part of 0009) | accepted | 2026-09-26 |
| [0138](ADR-0138-pnpm-run-setup.md) | Invoke the repository setup script as `pnpm run setup` | accepted | 2026-09-26 |
| [0139](ADR-0139-storybook-portable-stories.md) | Story tests through portable stories until `@storybook/addon-vitest` supports Vitest 5 | accepted | 2026-09-27 |

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
