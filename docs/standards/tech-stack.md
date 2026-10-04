# Tech stack

> Read when: adding, upgrading or removing a dependency; choosing a tool or library; wondering why
> something is the way it is. Research basis: `docs/research/05`. Decision record: ADR-0008.
> Family: Code · Related: [code-structure.md](code-structure.md), [security.md](security.md) §5.

The stack is **decided**. Changing a row in §1 needs an ADR. Versions are the targets verified in
research 05 (September 2026). **Check each one on npm before pinning**; the lockfile and
`pnpm-workspace.yaml` catalogs are the source of truth, not this table.

## 1. Decided stack

### Toolchain

| Concern | Choice | Target version (verify on npm) | Why |
|---|---|---|---|
| Runtime (dev, CLI, MCP) | Node.js LTS | ≥ 22.19 (24.x preferred) | `engines.node` / `.node-version`; tsdown needs ≥ 22.18, size-limit ≥ 22.19; npm OIDC publishing needs ≥ 22.14 |
| Package manager | pnpm workspaces + **catalogs** | 11.x, pinned via `packageManager` | strict `node_modules`, one version per dep, release-age gating on by default. pnpm 12 (Rust rewrite, same lockfile) is evaluated later |
| Task runner | Turborepo + remote cache | 2.11.x | tiny config, `--affected`, agents rarely misconfigure it |
| Language | TypeScript, strict, ESM only | TS 7.0.x as `typescript` (`tsc -b`) for typecheck; TS 6.0.x only from the `typescript6` catalog, the single TS 6 pin (one YAML-anchored string in pnpm-workspace.yaml) | TS 7 is ~10x faster; TypeDoc and dependency-cruiser need the TS 6 compiler API until TS 7.1; API Extractor bundles its own compiler and reads the emitted `.d.ts` (ADR-0011) |
| App build | Vite (Rolldown) + `@vitejs/plugin-react` (Oxc, React Compiler) | 8.1.x / 6.1.x | one fast bundler, no Babel anywhere |
| Library build | tsdown | 0.2x (pre-1.0) | Rolldown + fast `.d.ts` via `isolatedDeclarations` |
| Player single file | Vite library mode + `vite-plugin-singlefile` | latest Vite 8-aware | self-contained `.flux.html` |
| Lint + format | **Biome** | 2.5.x | one binary, one config, fast enough for every agent loop |
| Layering | dependency-cruiser | latest | gate `check-layering` |
| Hygiene | knip, publint, @arethetypeswrong/cli, size-limit | knip 6.x | dead code, broken `exports`, bundle budgets |
| Unit / browser / bench | Vitest (projects, browser mode, tags, agent reporter, v8 coverage) | 5.0.x | one runner for everything |
| Property tests | fast-check (+ `@fast-check/vitest`) | latest | geometry, undo, serialisation invariants |
| E2E / visual / a11y | Playwright (pinned Docker image for pixels) + `@axe-core/playwright` | 1.62.x | isolated retries, traces |
| UI catalog | Storybook + a11y addon; story tests via portable stories (addon-vitest once it supports Vitest 5, ADR-0139) | 10.6.x | every story is also a browser test |
| Mutation | tzap (`@huyz0/tzap`; ADR-0146) | 0.1.x | test-quality signal on pure packages: `pnpm mutate`, diff-scoped runs, nightly floors |
| Hooks / commits | Tracked `.githooks/` → Node gate scripts (`precommit.mjs`, `check-commit-msg.mjs`); subject `<TaskID>: <type>(<scope>): …` | — | Zero extra deps, identical on Windows/macOS/Linux, single gate definition shared with CI (lefthook/commitlint evaluated, not needed) |
| Release | Changesets + npm trusted publishing (OIDC, provenance) | latest | no long-lived npm tokens |
| Docs | Astro Starlight + TypeDoc + API Extractor + `starlight-llms-txt` | Starlight 0.42.x | docs as code, API diffs, LLM-ready |
| CI | GitHub Actions, single `ci-ok` required check, merge queue | — | always-green `main` |

### Runtime libraries

| Concern | Choice | Target | Why |
|---|---|---|---|
| UI | React + React Compiler | 19.3.x / 1.0 | stable; `<ViewTransition>` fits slide transitions |
| Document reactivity | own record store in `core` + **alien-signals** | latest | tiny, framework-free, runs in Node |
| Editor UI state | core signals (`@fluxion/core`) | — | a per-document session of signals read with `useValue` (ADR-0028); no Zustand |
| Schema | Zod (+ `z.toJSONSchema`) | 4.x | Standard Schema, JSON Schema for spec and MCP |
| Editor chrome | shadcn/ui on **Base UI** + Tailwind CSS | Base UI 1.x / Tailwind 4.3.x | accessible primitives, agent-fluent. **Editor only** (ADR-0010), from M7 without preflight; M6 chrome is a scoped `@layer fx.chrome` stylesheet with own splitters (ADR-0029) |
| Rich-text editing | ProseMirror (`prosemirror-model`, `-state`, `-view`, `-transform`, `-commands`, `-keymap`, `-inputrules`, `-schema-list`) | 1.x | stores ADR-0013 JSON natively; **editor only**, loaded by dynamic import while editing (ADR-0064) |
| Content styling | CSS custom properties from theme tokens + content CSS strings, `fx-` prefix, `@layer fx.content` (ADR-0015) | — | portable into `.flux.html`, Shadow DOM safe, identical in SSR and browser |
| Icons | Lucide (`lucide-react` in editor, raw SVG in player) | latest | ISC, tree-shakable |
| i18n | Lingui (ICU) | latest | compile-time extraction, small runtime |
| Zip / hashing | own zip codec in `format` (ADR-0153; fflate stays an option behind it), SubtleCrypto SHA-256 | — | small, no native deps, byte-identical output |
| Layout | own grid/stack; @dagrejs/dagre; d3-hierarchy + d3-flextree; d3-force; WebCola | latest | permissive licences (ADR-0005) |
| Optional packs | elkjs (EPL-2.0), libavoid-js (LGPL, wasm) | latest | lazy, unmodified, separate chunk |
| Animation helpers | WAAPI, flubber, d3-interpolate-path; Motion (editor UI only) | latest | own scheduler does the rest (ADR-0006) |
| DSL parsing | `yaml` | 2.x | source ranges for diagnostics |
| MCP | `@modelcontextprotocol/sdk` | latest | stdio + streamable HTTP |

## 2. Rejected alternatives

| Rejected | In favour of | Reason |
|---|---|---|
| Oxlint + tsgolint + Oxfmt | Biome | Evaluated: stronger type-aware rules. Rejected for now to keep one tool and one config; Oxfmt was beta. Revisit if floating-promise misses show up in review |
| ESLint + typescript-eslint + Prettier | Biome | slow; typescript-eslint does not support TS 7 |
| Nx, moon | Turborepo | more surface than we need; boundaries come from dependency-cruiser |
| npm / Yarn 4 / Bun | pnpm | no catalogs / PnP friction / runtime-semantics risk |
| tsup, unbuild | tsdown | tsup is in maintenance; tsdown is its successor |
| Jest | Vitest | second runner, slower, no browser mode |
| tldraw SDK, xyflow, JointJS as engine | own engine (ADR-0001) | licence (watermark / key), control over file format and player size |
| Tailwind in rendered content | tokens + content CSS strings (ADR-0015) | leaks into exported files; `@property` breaks in Shadow DOM |
| Redux, MobX, Jotai for document | record store + alien-signals | per-record fine-grained updates, framework-free |
| Valibot | Zod 4 | smaller, but weaker ecosystem; reconsider only if player size forces it |
| Vite+ | its building blocks | beta, lock-in; migration later is cheap |

## 3. Adding or upgrading a dependency

Each rule names its gate; `check-licenses.mjs` reads the allowlist from
`scripts/gates/thresholds.mjs`.

1. **Licence allowlist**: MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, MPL-2.0 (file-level
   copyleft is fine; do not modify MPL files). → `check-licenses`
   **Content assets** (fonts, icon/shape packs) may also be OFL-1.1, CC0-1.0 or CC-BY-4.0 with
   attribution embedded in files that use them (NFR-LIC-003); never code dependencies.
2. **EPL / LGPL only as an optional pack**: unmodified, lazily loaded in its own chunk or worker,
   never in the player core, notice shipped. Today: `elkjs` (`packs/layouts-elk`), `libavoid-js`
   (`packs/routing-libavoid`). GPL/AGPL/SSPL/BUSL: never. → `check-licenses` (per-pack allowlist)
3. **No watermark, domain-key or licence-key libraries** (e.g. tldraw SDK, bpmn-js, commercial
   diagram kits). Exported files must work anywhere, forever. → `check-licenses` denylist
4. **Bundle cost is justified in the PR**: state the gzip delta for every affected size-limit
   entry. Exceeding any budget fails the PR; budgets are not raised to make room. → size-limit in `pnpm verify`
5. **New runtime dependency in `player` (or anything it bundles) needs an ADR.** The player ships
   inside every saved file; each kB is paid by every viewer. → no gate — review + CODEOWNERS
6. **Pure packages take no dependency that touches DOM, timers, network or `node:*`.** →
   `check-layering`
7. **Add via catalog**: `catalog:` in the package, version once in `pnpm-workspace.yaml`. Never a
   second version of React, Zod or a signals library. → `pnpm verify` (knip + install check)
8. **Prefer writing 50 lines over adding a package** for a single helper. Health check before
   adding: maintained in the last 12 months, ESM, types included, no postinstall script. →
   no gate — judgement
9. **Upgrades come through Renovate**, grouped per catalog, respecting `minimumReleaseAge`. Majors
   get their own PR with release-note summary. → no gate — review
