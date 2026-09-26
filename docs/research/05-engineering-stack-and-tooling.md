# 05 — Engineering Stack & Tooling (research, as of late September 2026)

> Scope: monorepo tooling, code quality, testing, CI/CD, documentation, AI-agent-friendly engineering, and the frontend stack for the Fluxion editor, player, plugin SDK, CLI and (possible) MCP server.
> Method: web research in September 2026. Versions and dates come from official blogs and release notes where possible. Some come from secondary sources (InfoQ, heise, community write-ups); those are marked "(secondary)". **Check every version against npm before pinning.**

---

## 0. TL;DR: the ecosystem in September 2026

Big changes since 2024–2025 that affect the choices below:

| Area | What changed | Consequence for Fluxion |
|---|---|---|
| TypeScript | **TS 6.0** (Mar 2026) was the last JS-based release. It made `strict` the default and deprecated a lot of legacy options (`moduleResolution: node`, `baseUrl`, `outFile`, ES5…). **TS 7.0** (native Go compiler, "tsgo") went GA on **2026-07-08** (7.0.2) and is about 8–12x faster. **7.0 has no stable programmatic API.** That API is planned for **7.1** (beta ~Oct 6, stable targeted ~Nov 24, 2026). | Type-check with TS 7 (`tsc -b`). Keep **TS 6.0** installed as `typescript` for API-dependent tools (typescript-eslint, API Extractor, TypeDoc, Stryker checker) until 7.1 lands. |
| Vite / bundling | **Vite 8** (2026-03-12) uses **Rolldown** as its single bundler. **Vite 8.1** (2026-06-23) adds experimental Bundled Dev Mode. **Rolldown 1.0** stable came out 2026-05-07 (secondary). `@vitejs/plugin-react` v6 dropped Babel for Oxc, and v6.1 runs React Compiler through Oxc (`react({ compiler: true })`). | Build everything with Vite 8 + Rolldown. Use Babel nowhere. |
| Testing | **Vitest 4** (Oct 2025) made Browser Mode stable and added visual regression (`toMatchScreenshot`) and Playwright traces. **Vitest 4.1** (Mar 2026) added test tags and an **AI-agent reporter**. **Vitest 5.0** (2026-09-03) brings perf gains, a browser-mode trace view, nested projects with config inheritance, `vi.when()`, and benchmarks redesigned as fixtures. It requires Node ≥ 22.12 and Vite ≥ 6.4. | Use Vitest 5 as the single test runner (unit, component-in-browser, bench). |
| Linting | **Oxlint type-aware linting is stable** (2026-07-22). tsgolint v7 runs on TS 7 and covers 59 of typescript-eslint's 61 type-aware rules, 12–18x faster (secondary). Oxlint also has React Compiler rule support (Aug 2026) and **JS plugins (alpha)**. **Biome 2.5** (2026-06-05) has 500+ rules, plugin code fixes and cross-file linting, but its type inference is approximate. **typescript-eslint does not support TS 7** yet. **Oxfmt** beta (Feb 2026) passes 100% of Prettier's JS/TS conformance tests. | Oxlint (+ tsgolint) + Oxfmt are the fast, strict default. Biome is the fallback if you want a single tool. |
| Package manager | **pnpm 11** made `minimumReleaseAge = 1 day` and `blockExoticSubdeps` the defaults. **pnpm 12.0** (2026-08-26) is a Rust rewrite that stays compatible with pnpm 11 config, lockfile and CLI. **12.2/12.3** let catalogs hold `workspace:` versions. | pnpm 12 with catalogs and supply-chain defaults. |
| Monorepo runners | **Turborepo 2.11** (2026-09-18): up to 4x faster startup, `devEngines.packageManager` support, production pruning. 2.10 added `--affected` combined with `--filter`, and local cache eviction. **Nx 23.1** is current. **moon v2** shipped 2026-02-18. | Turborepo: simplest, and agents handle it well. |
| Toolchain bundling | **Vite+** (VoidZero) beta (Aug 2026) bundles Vite, Vitest, Rolldown, tsdown, Oxlint and Oxfmt behind one `vp` command, MIT licensed. | Worth watching. Don't depend on it yet (beta, lock-in concerns). The recommended stack is its building blocks anyway, so migrating later is cheap. |
| React | **React 19.3** (2026-09-09) makes `<ViewTransition>` and Fragment Refs stable. No React 20 yet. **React Compiler 1.0** stable since Oct 2025. | React 19.3 + Compiler on. View Transitions are directly useful for slide transitions. |
| UI kits | **Base UI 1.0** (2025-12-11). **shadcn/ui defaults to Base UI since July 2026** (Radix still supported). **Tailwind 4.3.x** (secondary). | shadcn/ui (Base UI flavour) + Tailwind v4 for editor chrome only. |
| Storybook | **Storybook 10** (Oct 2025) is ESM-only and has `@storybook/addon-vitest`. Latest is 10.6.x. | Stories become Vitest browser tests. |
| Playwright | **1.60** (May 2026) adds `locator.drop()` and a standalone `npx playwright trace`. **1.61** (Jun) adds passkeys and a Web Storage API. **1.62** (2026-07-24) runs **retries in isolation** (flaky tests can't pass by luck), adds AbortSignal for actions, reworks component testing, and supports WebP screenshots. | E2E + visual regression + a11y. |
| Publishing | **npm trusted publishing (OIDC)** GA since Jul 2025. It creates provenance automatically. Needs npm CLI ≥ 11.5.1 and Node ≥ 22.14. Configurations created after 2026-09-03 default to *staged* publish. There were 2026 worm incidents (e.g. the TanStack ecosystem, May 2026) caused by stolen tokens. | No long-lived npm tokens. Changesets + OIDC. |
| Agent conventions | **AGENTS.md** is stewarded by the Linux Foundation's Agentic AI Foundation (with MCP). Claude Code falls back to `AGENTS.md` when no `CLAUDE.md` exists (secondary; v2.1.277+). | `AGENTS.md` is the source of truth. `CLAUDE.md` imports it. |

---

## 1. Monorepo tooling

### 1.1 Package manager: pnpm workspaces + catalogs

- **Catalogs** (`catalog:` protocol in `pnpm-workspace.yaml`) define each dependency version once. From pnpm 12.2 they also accept `workspace:` ranges. This stops version drift across ~20+ packages, and agents stop "helpfully" adding a different React version.
- **Supply chain.** pnpm 11+ defaults to `minimumReleaseAge: 1440` (1 day) and `blockExoticSubdeps: true`. Keep both, and consider raising the release age to 3–7 days. Settings live in `pnpm-workspace.yaml` (canonical since v11).
- **pnpm 12** is a Rust rewrite (2026-08-26). It is compatible with v11 workflows. The one CI-breaking change: `install --resolution-only` became `pnpm peers check`. It is now at 12.6. Adopt 12.x, pinned via `packageManager`/`devEngines`. If you hit rewrite regressions, fall back to 11.x, which uses the same lockfile.

| Option | Verdict |
|---|---|
| pnpm 12 | **Choose.** Strict node_modules, catalogs, best monorepo ergonomics, supply-chain defaults. |
| npm workspaces | No catalogs, weaker isolation. |
| Bun | Fast, but its runtime and PM semantics are a risk for a Vite/Playwright-heavy stack. |
| Yarn 4 | Fine, but less momentum. PnP causes friction for tools. |

Sources: [pnpm 11.0](https://pnpm.io/blog/releases/11.0), [Socket on pnpm 11 defaults](https://socket.dev/blog/pnpm-11-adds-new-supply-chain-protection-defaults), [pnpm 12.0](https://pnpm.io/blog/releases/12.0), [pnpm 12.2–12.3](https://pnpm.io/blog/releases/12.2-12.3), [InfoQ pnpm 12 Rust](https://www.infoq.com/news/2026/09/pnpm-12-rust/)

### 1.2 Task runner: Turborepo vs Nx vs moon

| | **Turborepo 2.11** | **Nx 23.x** | **moon v2** |
|---|---|---|---|
| Model | Runs `package.json` scripts, with a task graph in `turbo.json` | Project graph, plugins, inferred targets, generators | Rust task runner with plugin toolchains (WASM) |
| Setup cost | Very low | Medium–high | Medium |
| Caching | Local + remote (Vercel, or self-hosted open-source server) | Local + Nx Cloud (+ self-hosted options) | Local + remote |
| Affected runs | `--affected` (combinable with `--filter` since 2.10) | `nx affected` (mature) | yes |
| Module boundaries | none built in | **`@nx/enforce-module-boundaries`** (tags) | project constraints/tags |
| Code generators | `turbo gen` (basic, Plop-based) | rich generators | templates |
| AI/agent features | plain config agents already know | Nx has AI/skills integration, agentic migrations | — |
| Fit for Fluxion | **Best**: tiny surface, predictable, agents rarely mis-configure it | Good if you want enforced tags and generators from day one | Niche |

**Choice: Turborepo.** Boundaries are enforced separately by dependency-cruiser (see §2.4). Nx is the fallback if the repo grows past ~50 packages, or if you want generator-driven scaffolding.

Sources: [Turborepo 2.11](https://turborepo.dev/blog/2-11), [Turborepo 2.10](https://turborepo.dev/blog/2-10), [Nx 22](https://nx.dev/blog/nx-22-release), [Nx 23.1](https://nx.dev/blog/nx-23-1-release), [moon v2.0](https://moonrepo.dev/blog/moon-v2.0), [InfoQ moon v2](https://www.infoq.com/news/2026/05/moonrepo-2-release/)

### 1.3 TypeScript: project references, `tsc -b`, TS 6 vs TS 7

- **Project references + `composite: true` + `tsc -b`** remain the right way to type-check a monorepo incrementally. tsgo supports `--build` with parallel builders (`--builders`, `--checkers`). Community reports say its incremental cache is slightly less aggressive than tsc 6 (secondary).
- **Dual install pattern (until TS 7.1):**
  - `typescript@6.0.x` stays as the `typescript` package, because typescript-eslint, API Extractor, TypeDoc, Storybook docgen and the Stryker TS checker import the compiler API.
  - Install TS 7 (native) under an alias/separate package and use it for `typecheck` (`tsgo -b`) and the editor LSP.
  - When 7.1 stabilises the API (target 2026-11-24), revisit and collapse to one version.
- **Because of TS 6 deprecations, write TS 7-clean config from day one:** `module: "preserve"` or `"nodenext"`, `moduleResolution: "bundler"`/`"nodenext"`, no `baseUrl`, no `outFile`, explicit `types: []` (the 6.0 default is now empty).
- **Internal packages.** Use `exports` maps with a custom condition (e.g. `"@fluxion/source": "./src/index.ts"`) plus `customConditions` in tsconfig/Vite, so apps consume source directly (no pre-build during dev). Publishable packages also emit `dist/` via tsdown.

**Recommended strict base `tsconfig`** (beyond `strict`, which is now the default):

```jsonc
{
  "compilerOptions": {
    "target": "es2023", "module": "preserve", "moduleResolution": "bundler",
    "lib": ["es2023", "dom", "dom.iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "isolatedDeclarations": true,      // fast .d.ts emit (tsdown/oxc), forces explicit export types = good for agents
    "erasableSyntaxOnly": true,        // no enums/namespaces/param-properties → Node type-stripping compatible
    "composite": true, "declaration": true, "declarationMap": true,
    "skipLibCheck": true,
    "types": []
  }
}
```

`isolatedDeclarations` and `erasableSyntaxOnly` are especially valuable with AI agents. Public APIs must carry explicit types, and the code stays plain JS with types.

Sources: [Announcing TS 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [InfoQ TS 7 released](https://www.infoq.com/news/2026/08/typescript-7-released/), [microsoft/typescript-go](https://github.com/microsoft/typescript-go), [TS 6.0 release (VS Magazine)](https://visualstudiomagazine.com/articles/2026/03/23/typescript-6-0-ships-as-final-javascript-based-release-clears-path-for-go-native-7-0.aspx), [TS 6.0 notes](https://typescriptdocs.com/release-notes/TypeScript%206.0), [typescript-eslint TS 7 issue](https://github.com/typescript-eslint/typescript-eslint/issues/12518), [TS 7 in monorepos (secondary)](https://codeclash.dev/blog/typescript-7-monorepos-turborepo-nx-pnpm/)

### 1.4 Package builds

| Tool | Engine | Status (Sep 2026) | Use in Fluxion |
|---|---|---|---|
| **tsdown** | Rolldown + Oxc (fast `.d.ts` with `isolatedDeclarations`) | 0.2x, pre-1.0 but very active, successor to tsup, part of Vite+ | **Libraries**: `core`, `schema`, `sdk`, `renderer`, `cli` |
| tsup | esbuild | maintenance mode, points users to tsdown | avoid for new work |
| unbuild | Rollup/mkdist | stable, UnJS-centric | not needed |
| **Vite 8 library mode** | Rolldown | stable | **Player bundle** (IIFE/ESM, CSS handling), web components |
| Rolldown direct | — | 1.0 (May 2026, secondary) | only for special cases |

- **Single-file player.** `vite-plugin-singlefile` supports Vite 8 (it uses `codeSplitting: false` on Rolldown and `inlineDynamicImports` before that). Use it to export a self-contained `presentation.html` (player + deck JSON + fonts/images as data URIs). Set a size budget.
- **Versioning.** Use **Changesets** (§4.4).

Sources: [tsdown](https://tsdown.dev/), [tsdown releases](https://github.com/rolldown/tsdown/releases), [Vite 8](https://vite.dev/blog/announcing-vite8), [Vite 8.1](https://vite.dev/blog/announcing-vite8-1), [InfoQ Vite 8](https://www.infoq.com/news/2026/05/vite-v8-rust/), [vite-plugin-singlefile source](https://github.com/richardtallent/vite-plugin-singlefile/blob/main/src/index.ts), [Vite+ beta](https://voidzero.dev/posts/announcing-vite-plus-beta), [InfoQ Vite+](https://www.infoq.com/news/2026/08/vite-plus-beta/)

---

## 2. Code quality

### 2.1 Linter / formatter comparison

| | **Oxlint + tsgolint + Oxfmt** | **Biome 2.5** | **ESLint 9/10 flat + typescript-eslint + Prettier** |
|---|---|---|---|
| Speed | fastest (Rust; type-aware in Go on TS 7) | very fast | slow (type-aware is the bottleneck) |
| Type-aware rules | **real TS 7 type checker**; 59/61 typescript-eslint type rules (e.g. `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`) | own inference engine, approximate (≈75% parity on floating promises per a secondary benchmark) | complete, but **blocked on TS 6 API** (no TS 7 support until 7.1) |
| React / hooks / Compiler rules | yes (React, jsx-a11y, React Compiler support Aug 2026) | yes (subset) | reference implementation (`eslint-plugin-react-hooks` includes compiler rules) |
| Plugin ecosystem | JS plugins (ESLint-compatible API) in **alpha** | GritQL plugins | full |
| Formatter | Oxfmt (beta, 100% Prettier JS/TS conformance, built-in Tailwind class sorting and import sorting) | built in | Prettier |
| Config surface | 2 tools (`.oxlintrc.json`, `.oxfmtrc.json`) | 1 file | many |

**Choice: Oxlint (with type-aware on) + Oxfmt.** For agent-written code, the rules that matter most are the type-aware ones (floating promises, unsafe `any` flows, exhaustive switches). Oxlint runs them with the real compiler at interactive speed, which makes it practical in pre-commit and in the agent's inner loop. Keep a **small ESLint config only if** you need a plugin that Oxlint's JS-plugin layer can't run yet. Don't add it by default.
**Fallback: Biome 2.5** if you want one binary and can accept approximate type-aware coverage.

Sources: [Oxlint type-aware stable](https://oxc.rs/blog/2026-07-22-type-aware-linting-stable), [InfoQ tsgolint v7](https://www.infoq.com/news/2026/09/tsgolint-oxlint-typescript/), [Oxlint React Compiler support](https://oxc.rs/blog/2026-08-18-react-compiler-support), [Oxfmt beta](https://oxc.rs/blog/2026-02-24-oxfmt-beta.html), [Biome v2.5](https://biomejs.dev/blog/biome-v2-5/), [Biome roadmap 2026](https://biomejs.dev/blog/roadmap-2026/), [Biome vs Oxlint 2026 (secondary)](https://dev.to/jsmanifest/biome-vs-oxlint-in-2026-which-rust-powered-linter-should-you-replace-eslint-with-48lh), [cpojer: Fastest frontend tooling](https://cpojer.net/posts/fastest-frontend-tooling)

### 2.2 Rule policy (agent-oriented)

- Turn on `correctness`, `suspicious` and `perf` as **errors**, and selected `pedantic` rules.
- Ban `any` (`no-explicit-any`), non-null assertions, `@ts-ignore` (allow `@ts-expect-error` only with a description), default exports (named exports are easier for agents to grep and refactor), barrel re-exports deep inside packages, and `console` in libraries.
- Warnings are errors in CI (`--deny-warnings`). Agents ignore warnings.
- Complexity guards: max file length (~300–400 lines), max function length, max params. Small files keep agent context focused.

### 2.3 Architecture boundary enforcement

| Tool | Strength | Weakness |
|---|---|---|
| **dependency-cruiser** | Rules across the whole graph: layers, `no-circular`, orphans, "no dev deps in prod", "renderer must not import React DOM", and so on. It can also draw graphs. Runs in CI. | Not inline in the editor. Slower. |
| eslint-plugin-boundaries | Instant feedback in the IDE | Needs ESLint, which is blocked on TS 7 |
| Nx module boundaries | Tag-based, mature | Needs Nx |
| Package-level `exports` + pnpm strictness | Prevents deep imports physically | Coarse |

**Choice: dependency-cruiser + strict `exports` maps + pnpm's strict node_modules.** Fluxion's layers (proposed):

```
schema (pure types/validation)  ←  core (document model, commands, geometry; no DOM)
      ←  renderer (DOM/SVG/canvas, framework-free)  ←  player (runtime)  ←  react bindings  ←  editor app
sdk (plugin API) depends only on schema/core public types; plugins depend only on sdk.
cli / mcp-server depend on core/schema, never on editor/react.
```

Encode these as `forbidden` rules. Add `no-circular` and a rule that `core` may not import any `dom`/`react` modules.

Sources: [dependency-cruiser (Xebia)](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/), [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries), [Nx boundaries](https://www.stefanos-lignos.dev/posts/nx-module-boundaries)

### 2.4 Dead code, bundle budgets, other gates

- **Knip v6** (now uses oxc-parser, faster; needs Node ≥ 20.19; 6.37.x in Sep 2026). Finds unused files, exports and dependencies across the monorepo. It is highly valuable against agent leftovers.
- **size-limit.** Budgets per published entry (player IIFE, single-file HTML, sdk). Fails the PR when a budget is exceeded.
- **publint** + **@arethetypeswrong/cli** on publishable packages (`exports`/types correctness).
- **syncpack** is optional. Catalogs cover most of what it does.

Sources: [Knip v6](https://knip.dev/blog/knip-v6)

---

## 3. Testing

### 3.1 Test pyramid for Fluxion

| Layer | Tool | What |
|---|---|---|
| Unit (Node) | **Vitest 5** | schema, core model, commands/undo, geometry, layout, serializers |
| Property-based | **fast-check** (+ `@fast-check/vitest`) | geometry invariants (bbox containment, transform inverse, snapping idempotence), serialization round-trips, undo/redo `apply(inverse(apply(x))) == x`, layout never overlaps |
| Golden / snapshot | Vitest file snapshots (`toMatchFileSnapshot`) | normalized SVG/HTML output of the renderer for fixture decks; exported JSON |
| Component (real browser) | **Vitest Browser Mode** (Playwright provider, Chromium) + **Storybook 10 + `@storybook/addon-vitest`** | editor widgets, renderer components, interaction tests via `play` |
| Visual regression | Vitest `toMatchScreenshot` (component level) and Playwright `toHaveScreenshot` (page level) | pixel diffs **only inside the pinned Playwright Docker image** |
| E2E | **Playwright 1.62** | editor flows, player navigation, export/import, file handling |
| a11y | `@axe-core/playwright` in E2E, axe in Storybook a11y addon / Vitest browser | WCAG 2.2 AA on editor and player |
| Performance | Vitest 5 benchmarks (now fixtures inside tests) / tinybench | layout/render hot paths, with regressions tracked |
| Mutation | **StrykerJS + vitest-runner** | only `core` and `geometry`, nightly/weekly, not per-PR |
| Coverage | `@vitest/coverage-v8` (AST-aware remapping) | thresholds per package (e.g. core ≥ 90% lines/branches). Coverage is a floor, not a target. |

### 3.2 Vitest configuration notes

- Use **`projects`** (in Vitest 5 they are nested and inherit the root config) so one root `vitest` run covers all packages with separate `node` and `browser` environments.
- Use **test tags** (4.1+) to split `@fast`, `@browser`, `@visual` and `@slow`. The agent inner loop runs only the fast ones.
- Use the **agent reporter** (4.1+): compact, machine-oriented failure output for Claude Code / Codex runs.
- In Vitest 5, `clearMocks` is on by default and async assertions are stricter. Both help catch agent mistakes.

### 3.3 Deterministic canvas/SVG testing (important for a diagram product)

1. **Prefer structural over pixel tests.** Render to SVG/DOM, **normalize** (sort attributes, round numbers to 2–3 decimals, strip generated IDs) and compare to golden files. Structural goldens are stable across OSes and easy for agents to read in diffs.
2. **Pixel tests only in a pinned environment.** Use the official `mcr.microsoft.com/playwright:vX.Y.Z` image in CI and locally (`docker run`). Bundle and self-host fonts, and wait for `document.fonts.ready`. Fix `deviceScaleFactor`, viewport, locale, timezone and `prefers-reduced-motion`. Disable animations (`animations: "disabled"`). Mask volatile regions. Use a small `maxDiffPixelRatio`.
3. **Canvas.** Draw through an abstraction that has a **recording backend** (a command list) for unit tests, and assert on the draw calls. Keep pixel checks for a few canvas scenarios only.
4. **Seed everything.** Inject RNG and clock (`vi.useFakeTimers`, `page.clock`), and give IDs a deterministic generator in tests.
5. **Isolated retries** (Playwright 1.62) plus a **zero-flake policy**. A test that needs a retry to pass is quarantined with an issue, and never left silently retrying.

### 3.4 Storybook vs alternatives

- **Storybook 10** is ESM-only, ~29% lighter, has CSF Factories (React) and `sb.mock`. With addon-vitest, every story is a browser test. Keep it for the **design system** and the **renderer component gallery**. It also becomes a public "plugin component playground".
- **Chromatic alternatives:** Playwright/Vitest screenshots committed to the repo (free, deterministic in Docker), or **Lost Pixel** (OSS, Storybook/page modes). Start with committed screenshots in Docker. Add a hosted review UI only if visual review becomes a bottleneck.

Sources: [Vitest 4.0](https://vitest.dev/blog/vitest-4), [Vitest 4.1](https://vitest.dev/blog/vitest-4-1.html), [InfoQ Vitest 4.1 agent reporter](https://www.infoq.com/news/2026/05/vitest-4-1-ai-agents/), [Vitest 5.0](https://vitest.dev/blog/vitest-5.html), [Storybook 10](https://storybook.js.org/blog/storybook-10/), [Storybook Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon), [Playwright release notes](https://playwright.dev/docs/release-notes), [Playwright 1.62 summary (secondary)](https://testdino.com/blog/playwright-1-62-release), [Stryker Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)

---

## 4. CI/CD

### 4.1 GitHub Actions layout

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | PR, merge_group, push main | `setup` (pnpm cache) → parallel: `lint` (oxlint, oxfmt --check), `typecheck` (tsgo -b), `test` (vitest projects, `turbo run test --affected`), `build`, `boundaries` (depcruise), `knip`, `size`, `e2e` (Playwright sharded 1/N..N/N + `merge-reports`), `visual` (Docker image) → **`ci-ok` aggregate job** (the only required check) |
| `preview.yml` | PR | deploy editor + docs + Storybook previews, then comment the URLs |
| `release.yml` | push main | `changesets/action` opens a "Version Packages" PR, and merging it publishes via OIDC |
| `security.yml` | PR + schedule | CodeQL (JS/TS), OSV-Scanner, `zizmor` (workflow linter), dependency review |
| `nightly.yml` | cron | Stryker, full visual suite on all browsers, benchmark trend, knip strict |

Best practices:

- Use `pnpm/action-setup` + `actions/setup-node` with `cache: pnpm`. Also cache the Playwright browsers, keyed by version, or run the Playwright container image.
- **Turbo remote cache**: Vercel Remote Cache, or a self-hosted OSS cache server with `TURBO_TOKEN`/`TURBO_TEAM` in secrets. Use `--affected` on PRs.
- `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }` for PRs.
- **Pin third-party actions by commit SHA.** Set `permissions:` to least privilege (default `contents: read`). Only the release job gets `id-token: write`.
- Use **one aggregate required check** (`ci-ok`) so that matrix and shard changes never need branch-protection edits.
- Use the **merge queue** (`merge_group` trigger) so main is always green.
- Use Node 22 LTS or 24 (Vitest 5 needs ≥ 22.12, and npm trusted publishing needs ≥ 22.14).

### 4.2 Branching and commits

- **Trunk-based development.** Short-lived branches, squash merges, and a linear history via rulesets (require PR, `ci-ok`, CODEOWNERS review for `schema`/`sdk` public API, signed commits optional).
- **Conventional Commits** checked by **commitlint** in a `commit-msg` hook and in CI (PR title lint for squash merges).
- **lefthook** over husky. It is a single Go binary, runs hooks in parallel, uses glob and root-scoped commands (monorepo-friendly), and has no separate lint-staged. Pre-commit runs oxfmt + oxlint on staged files. Pre-push runs `pnpm verify:fast`.

### 4.3 Preview deployments

| Host | Notes | Fit |
|---|---|---|
| **Cloudflare Workers (static assets)** | Recommended over Pages for new projects in 2026. Pages is not deprecated, but Workers has feature parity. Preview URLs per version/branch. Free static asset serving. | **Choose** (editor is a static SPA, player is static) |
| Cloudflare Pages | Still fine, git-connected previews | alternative |
| Vercel / Netlify | Excellent PR previews and DX | alternative. Vercel pairs with Turbo remote cache |

### 4.4 Release automation and supply chain

- **Changesets** plus `changesets/action`, with pnpm (`pnpm changeset publish`). Agents add a changeset file as part of any PR that touches a publishable package, and a CI check enforces it.
- **npm trusted publishing (OIDC).** No `NPM_TOKEN`. Provenance is automatic. Configure a trusted publisher per package, and consider **staged publish** (the default for new configs after 2026-09-03) with a manual approve step.
- **Renovate** over Dependabot for monorepos. It groups by catalog, respects `minimumReleaseAge`, and supports automerge for dev deps behind CI. Dependabot alerts and security updates stay on.
- **CodeQL**, **OSV-Scanner**, GitHub secret scanning + push protection, `zizmor` for workflow security, and optionally `step-security/harden-runner`.

Sources: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/), [GitHub changelog: OIDC GA](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/), [pnpm + changesets](https://pnpm.io/using-changesets), [Cloudflare Pages → Workers migration](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/), [Workers static assets](https://developers.cloudflare.com/workers/static-assets/), [lefthook vs husky (secondary)](https://www.pkgpulse.com/guides/husky-vs-lefthook-vs-lint-staged-git-hooks-nodejs-2026), [tokenless publishing playbook (secondary)](https://bex.co/blog/2026/09/10/npm-trusted-publishing-oidc-tokenless-pipeline)

---

## 5. Documentation

| Need | Tool | Notes |
|---|---|---|
| Docs site (guides, plugin SDK, file format spec) | **Astro Starlight** (0.42.x; recent versions support Astro 7) | MDX, search (Pagefind), i18n, fast, easy for agents to edit. Alternatives: VitePress (Vue-centric), Docusaurus (heavier, React). |
| API reference | **TypeDoc** (+ `starlight-typedoc`) | generated from TSDoc comments on public packages |
| API surface reports | **API Extractor** (`.api.md` committed) | Any public API change shows up as a reviewable diff, which guards the SDK against accidental agent changes. Runs on the TS 6 API for now. |
| Architecture decisions | **ADRs, MADR 4 template** in `docs/adr/NNNN-title.md` | agents must read the relevant ADRs before changing an area, and write a new ADR for new decisions |
| Architecture diagrams | **C4 model** as code: Structurizr DSL or **LikeC4**, or Mermaid C4 for simple cases | text diagrams diff cleanly and agents can edit them |
| LLM-facing docs | **llms.txt** via `starlight-llms-txt` (llms.txt, llms-full.txt, llms-small.txt) | helps both internal agents and external users building plugins |
| Format spec | JSON Schema generated from the schema package (e.g. Zod 4 `z.toJSONSchema`) and published with the docs | also feeds the MCP server tool schemas |

Sources: [Starlight releases](https://github.com/withastro/starlight/releases), [What's new in Astro, Jul 2026](https://astro.build/blog/whats-new-july-2026/), [starlight-llms-txt](https://github.com/delucis/starlight-llms-txt), [MADR](https://adr.github.io/madr/), [C4 model](https://c4model.com/), [llmstxt.org](https://llmstxt.org/)

---

## 6. AI-agent-friendly engineering

### 6.1 Principles, and what each one does for agents

| Convention | Why it helps Claude Code / Codex |
|---|---|
| **`AGENTS.md` at the root + per-package `AGENTS.md`** (commands, invariants, boundaries, "do/don't") and a thin `CLAUDE.md` that imports `@AGENTS.md` | One source of truth across tools. AGENTS.md is a Linux Foundation (AAIF) stewarded convention. |
| **One `pnpm verify` command** (format check → lint → typecheck → test → boundaries → knip) with the same steps as CI, plus `verify:fast` for affected packages | The agent has an unambiguous definition of done |
| **Fast feedback**: Rust/Go tools (Oxlint, Oxfmt, tsgo, Rolldown), Turbo cache, `--affected`, Vitest tags | Agents iterate many times, so a 5 s loop beats a 2 min one |
| **Small files, single responsibility, named exports, explicit return types** (`isolatedDeclarations`) | Less context to load, precise edits, greppable |
| **Co-located tests** (`foo.ts` + `foo.test.ts`), fixtures in `__fixtures__` | Agents find and update the right test |
| **Golden tests** for renderer output and file format | Output changes become reviewable diffs. Update them with `-u`, only intentionally. |
| **Property-based tests** on core invariants | Catch edge cases agents don't think of |
| **Strict types + type-aware lint as errors** | The compiler catches most agent mistakes cheaply |
| **Deterministic scripts** (no interactive prompts, stable output, non-zero exit on failure, `--reporter=agent`) | Agents parse results reliably |
| **Public API reports + changesets required** | Accidental breaking changes get flagged |
| **Architecture rules as code** (dependency-cruiser) | Agents can't erode the layers without CI failing |
| **Zero-flake policy + isolated retries** | Flaky tests teach agents to ignore failures |
| **Guardrails**: lefthook pre-commit (fast), CI `ci-ok` required check, CODEOWNERS on `schema`/`sdk`, protected main, merge queue | Defence in depth. Hooks can be skipped, CI can't. |
| **Scaffolding generators** (`turbo gen` templates for package, plugin, component) | New code starts in the house style |
| **ADRs + llms.txt** | Agents understand why things are the way they are |

### 6.2 Suggested repo scripts

```
pnpm verify          # full local gate == CI
pnpm verify:fast     # affected packages only: oxfmt --check, oxlint, tsgo -b, vitest --tags fast
pnpm test:browser    # vitest browser projects
pnpm test:e2e        # playwright (docker for visual)
pnpm fix             # oxfmt + oxlint --fix
pnpm gen <template>  # scaffolding
```

Sources: [Linux Foundation AAIF announcement](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation), [agents.md](https://agents.md/), [Claude Code AGENTS.md fallback (secondary)](https://www.infoworld.com/article/4224410/claude-code-now-also-accepts-instructions-in-openais-agents-md-format.html), [Vitest agent reporter (InfoQ)](https://www.infoq.com/news/2026/05/vitest-4-1-ai-agents/)

---

## 7. Frontend stack (editor, player, rendering)

### 7.1 React

- **React 19.3** (2026-09-09). `<ViewTransition>` is stable, which is a natural fit for slide and step transitions (progressive enhancement over the browser View Transition API). Fragment Refs are stable.
- **React Compiler 1.0.** Enable it via `@vitejs/plugin-react` v6.1 `compiler: true` (Oxc-based, >10x faster than the Babel plugin per the Oxc team). The Oxlint React Compiler rules flag code the compiler can't optimize.
- **Keep the document model and renderer framework-free.** `core` is pure TS. The renderer targets DOM/SVG directly, or as a thin React layer over pure functions. The player must be embeddable without the editor, and later maybe without React at all (web component wrapper).

### 7.2 State

| Option | Fit |
|---|---|
| **Zustand 5** | **Editor application state** (selection, tools, panels, UI prefs). Tiny, no provider, selector-based, works with `useSyncExternalStore`. |
| Jotai | Fine-grained per-atom state. An option for property-panel or inspector-heavy UIs. |
| Signals / Legend State | Performant. Legend State has maintenance concerns (issue ratio, secondary). Skip. |
| **Document store** | **Custom, in `core`**: immutable document plus a **command/patch** system (Immer/Mutative patches or hand-written inverse ops) for undo/redo, collaboration-readiness (CRDT such as Yjs/Loro later) and MCP/CLI reuse. Expose to React via `useSyncExternalStore`, or a Zustand vanilla store wrapper. |

**Validation / schema:** **Zod 4**. It has the largest ecosystem, uses Standard Schema, can generate JSON Schema, and MCP SDKs accept it. Use Valibot if the *player* bundle can't afford Zod. Only the editor, CLI and MCP need full validation, and the player can trust pre-validated decks or use a lightweight check.

### 7.3 UI kit and styling (with style isolation for the rendered document)

Two separate styling worlds:

1. **Editor chrome** (panels, menus, dialogs): **shadcn/ui on Base UI** (Base UI 1.0 since Dec 2025, shadcn's default since Jul 2026) + **Tailwind CSS v4** (CSS-first `@theme`, OKLCH, cascade layers). Agents are very fluent in this combination. The code is owned and copied into the repo, so it is easy to adjust.
2. **Rendered document / player** (must be themeable and portable: embeds, single-file HTML, exports):
   - **No Tailwind dependency.** Use **plain CSS / CSS Modules with design tokens as CSS custom properties** (`--fx-color-*`, `--fx-font-*`, `--fx-space-*`) in a named `@layer fluxion`, with class prefixes (`fx-`) and `@scope` for containment.
   - **Themes = token sets** (JSON → CSS variables), switchable at runtime and serialisable into the deck file.
   - **Embedding mode:** mount the player in **Shadow DOM** (a custom element `<fluxion-player>`) for style isolation from host pages. Note a known pitfall: Tailwind v4's `@property` registrations don't work inside shadow roots, which is one more reason to keep Tailwind out of the renderer. Custom properties themselves do inherit through the shadow boundary, so host-level theming stays possible by design.
   - vanilla-extract is a viable typed alternative for tokens, but it adds a build step to every consumer. CSS Modules + a token JSON is simpler.
- **Icons:** **Lucide** (`lucide-react` for the editor, and raw SVG/`lucide` for the player to avoid a React dependency). Tree-shake by named import.
- **i18n:** Lingui (compile-time message extraction, small runtime) or i18next/react-i18next (largest ecosystem). Leaning Lingui for the editor. Deck content i18n is a document-model concern, not a UI-library concern.

### 7.4 PWA, files, desktop

| Topic | Recommendation |
|---|---|
| Offline/PWA | **vite-plugin-pwa** (Workbox). Precache the editor shell. Documents live locally. |
| Local files | **File System Access API** (Chromium: open/save handles, directory access). **OPFS** for autosave and recovery in all modern browsers. Fall back to download/upload (e.g. `browser-fs-access` pattern) for Firefox/Safari. Put this behind a `FileSystemPort` interface in core so CLI/Tauri/Electron can provide their own adapters. |
| Desktop (later) | **Tauri 2** by default: 2.5–10 MB bundles, ~30–50 MB RAM, Rust backend, capability-based permissions. The **caveat** is that rendering differs between WebView2, WKWebView and WebKitGTK. For a presentation/diagram product where pixel fidelity matters, run the Playwright visual suite on WebKit as well. Choose **Electron** only if cross-OS rendering parity or Node APIs become critical. |

Sources: [React 19.3 release](https://github.com/react/react/releases/tag/v19.3.0), [React Compiler v1.0](https://react.dev/blog/2025/10/07/react-compiler-1), [React Compiler + plugin-react v6 (secondary)](https://recca0120.github.io/en/2026/04/14/react-compiler-vite-v6/), [shadcn/ui: Base UI as default (Jul 2026)](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default), [InfoQ Base UI v1](https://infoq.com/news/2026/02/baseui-v1-accessible/), [Tailwind v4 + shadow DOM discussion](https://github.com/tailwindlabs/tailwindcss/discussions/15556), [Embeddable widgets w/ Tailwind 4 & Web Components (Viget)](https://www.viget.com/articles/embeddable-widgets-with-vite-react-tailwind-4-web-components), [Zod 4 vs Valibot vs ArkType (secondary)](https://pockit.tools/blog/zod-valibot-arktype-comparison-2026/), [State management 2026 (secondary)](https://saschb2b.com/blog/react-state-management-2026), [Tauri vs Electron 2026 (secondary)](https://www.pkgpulse.com/guides/electron-vs-tauri-2026)

---

## 8. RECOMMENDATION: concrete stack

### 8.1 Stack choice list

| Concern | Choice | Version target (verify on npm) | Rationale |
|---|---|---|---|
| Runtime | Node.js 24 LTS (min 22.14) | 24.x | needed by Vitest 5 and npm OIDC |
| Package manager | **pnpm** workspaces + **catalogs** | 12.x (fall back to 11.x) | strict, catalogs, supply-chain defaults |
| Task runner | **Turborepo** + remote cache | 2.11.x | minimal config, `--affected`, agents understand it |
| Language | **TypeScript**, strict + `isolatedDeclarations` + `erasableSyntaxOnly` | TS 7.0.x for type-checking (`tsgo -b`), TS 6.0.x kept for API tools until 7.1 | 10x faster checks; TS 7-clean config from day one |
| App bundler/dev | **Vite 8** (Rolldown) + `@vitejs/plugin-react` v6 (Oxc, React Compiler) | 8.1.x / 6.1.x | one fast bundler, no Babel |
| Library builds | **tsdown** | 0.2x (pre-1.0) | Rolldown + Oxc `.d.ts`; tsup successor |
| Player single-file | Vite library mode + **vite-plugin-singlefile** | latest (Vite 8 aware) | self-contained HTML export |
| Lint | **Oxlint + tsgolint (type-aware)** | latest 1.x / tsgolint v7 | real type-aware rules at Rust/Go speed |
| Format | **Oxfmt** (Biome as single-tool fallback) | latest | Prettier-compatible, built-in import/Tailwind sorting |
| Architecture rules | **dependency-cruiser** + `exports` maps | latest | layered boundaries, no-circular |
| Dead code / packaging | **Knip**, **publint**, **attw**, **size-limit** | knip 6.x | keep agent output clean and budgets enforced |
| Unit/component/bench | **Vitest** (projects, browser mode via Playwright, tags, agent reporter, v8 coverage) | 5.0.x | one runner for everything |
| Property tests | **fast-check** | latest | geometry, layout, undo invariants |
| Stories | **Storybook 10** + addon-vitest + a11y addon | 10.6.x | component gallery that doubles as tests |
| E2E/visual/a11y | **Playwright** (Docker image for screenshots) + **@axe-core/playwright** | 1.62.x | isolated retries, traces, sharding |
| Mutation | **StrykerJS** (vitest-runner), nightly on `core` | latest | test-quality signal for agent-written tests |
| Git hooks / commits | **lefthook** + **commitlint** (Conventional Commits) | latest | fast, monorepo-aware |
| Versioning/release | **Changesets** + `changesets/action` + **npm trusted publishing (OIDC, staged publish)** | latest | tokenless, provenance |
| Deps/security | **Renovate**, CodeQL, OSV-Scanner, zizmor, SHA-pinned actions, secret push protection | — | supply-chain hardening |
| CI | GitHub Actions, one `ci-ok` required check, merge queue, concurrency cancel, Playwright sharding | — | trunk-based, always-green main |
| Previews | **Cloudflare Workers static assets** (editor, docs, Storybook per PR) | — | cheap, fast; Vercel/Netlify as alternatives |
| Docs | **Astro Starlight** + TypeDoc (`starlight-typedoc`) + **API Extractor** reports + **starlight-llms-txt** | Starlight 0.42.x | docs as code, LLM-ready |
| Decisions/diagrams | **MADR 4** ADRs, **C4** via LikeC4/Structurizr DSL (Mermaid for small ones) | — | text-based, diffable |
| Agent instructions | **AGENTS.md** (root + per package) + `CLAUDE.md` importing it, `pnpm verify` | — | cross-tool standard, one definition of done |
| UI framework | **React 19.3** + **React Compiler 1.0** | 19.3.x | stable; ViewTransition for slide transitions |
| Editor state | **Zustand 5** (UI state) + custom command/patch document store in `core` | 5.x | simple; undo/redo and collaboration-ready |
| Schema/validation | **Zod 4** (JSON Schema export for spec + MCP) | 4.x | ecosystem; Valibot if player size demands |
| Editor UI | **shadcn/ui (Base UI)** + **Tailwind v4** | Base UI 1.x, Tailwind 4.3.x | agent-fluent, accessible primitives |
| Document/player styling | **CSS Modules/plain CSS + CSS custom-property tokens**, `@layer`, `fx-` prefix, Shadow DOM for embeds | — | portable, themeable, isolated |
| Icons | **Lucide** | latest | consistent, tree-shakable |
| i18n | **Lingui** (alt: i18next) | latest | compile-time extraction, small runtime |
| Offline | **vite-plugin-pwa** + OPFS autosave + File System Access API behind a port | latest | local-first editing |
| Desktop (later) | **Tauri 2** (Electron if render parity is critical) | 2.x | small, secure; test on WebKit |

### 8.2 Rationale summary

1. **Speed is a feature for AI agents.** Every tool in the inner loop is native (Rolldown, Oxc, Oxlint/tsgolint, Oxfmt, tsgo, pnpm 12). The full `verify` should run in seconds for affected packages, so agents run it every time.
2. **Strictness replaces human review bandwidth.** Strict TS, type-aware lint as errors, dependency-cruiser layers, API Extractor reports, knip, size-limit and golden tests turn "is this right?" into machine-checkable gates.
3. **Separation of the portable renderer from the editor.** A framework-free `core` and renderer, token-based CSS and a Shadow DOM embed keep exported presentations themeable and independent of the editor's Tailwind/shadcn choices.
4. **Coherent ecosystem, low lock-in.** Most picks come from the Vite/VoidZero toolchain (Vite, Vitest, Rolldown, tsdown, Oxlint, Oxfmt). That makes a later move to **Vite+** trivial if it matures, but nothing depends on it today.
5. **Supply-chain safety by default.** pnpm release-age gating, Renovate grouping, SHA-pinned actions, OIDC staged publishing and provenance. This matters given the 2026 npm worm incidents.

### 8.3 Known risks and revisit points

| Risk | Mitigation / trigger to revisit |
|---|---|
| TS 7 has no compiler API until 7.1 (Nov 2026 target) | Run the dual TS 6/7 install. Collapse to 7.1 once typescript-eslint-free tooling (API Extractor, TypeDoc, Stryker) supports it. |
| tsdown is pre-1.0 | Low risk (tsup-compatible options). Can fall back to Vite library mode. |
| Oxfmt beta, Oxlint JS plugins alpha | Biome 2.5 as a drop-in fallback for format/lint. Keep lint config small. |
| pnpm 12 is a fresh Rust rewrite | Pin the version. Fall back to 11.x (same lockfile and config). |
| Pixel-diff flakiness | Structural SVG goldens first. Pixels only in the Docker image. Isolated retries + quarantine. |
| Tauri WebView rendering differences | Run the WebKit visual suite. Electron is the escape hatch. |
| Vite+ could become the "default" toolchain | Re-evaluate at Vite+ 1.0. Migration is mostly config consolidation. |

---

## Appendix A: verified release dates (September 2026)

| Item | Version / date | Source |
|---|---|---|
| TypeScript 6.0 | Mar 2026, last JS-based release | [VS Magazine](https://visualstudiomagazine.com/articles/2026/03/23/typescript-6-0-ships-as-final-javascript-based-release-clears-path-for-go-native-7-0.aspx) |
| TypeScript 7.0 | GA 2026-07-08 (7.0.2); 7.1 targeted 2026-11-24 | [InfoQ](https://www.infoq.com/news/2026/08/typescript-7-released/), [Diego Betto (secondary)](https://diegobetto.com/en/typescript-7-whats-new/) |
| Vite 8 / 8.1 | 2026-03-12 / 2026-06-23 | [vite.dev](https://vite.dev/blog/announcing-vite8), [vite.dev 8.1](https://vite.dev/blog/announcing-vite8-1) |
| Vitest 4 / 4.1 / 5 | 2025-10-22 / 2026-03-12 / 2026-09-03 | [vitest.dev](https://vitest.dev/blog/vitest-5.html) |
| Playwright 1.60 / 1.61 / 1.62 | 2026-05-11 / 06-15 / 07-24 | [TestDino (secondary)](https://testdino.com/playwright-releases), [playwright.dev](https://playwright.dev/docs/release-notes) |
| Turborepo 2.10 / 2.11 | 2026-06-24 / 2026-09-18 | [turborepo.dev](https://turborepo.dev/blog/2-11) |
| pnpm 11 / 12.0 | 2026 / 2026-08-26 | [pnpm.io](https://pnpm.io/blog/releases/12.0) |
| Oxlint type-aware stable | 2026-07-22 | [oxc.rs](https://oxc.rs/blog/2026-07-22-type-aware-linting-stable) |
| Oxfmt beta | 2026-02-24 | [oxc.rs](https://oxc.rs/blog/2026-02-24-oxfmt-beta.html) |
| Biome 2.5 | 2026-06-05 | [biomejs.dev](https://biomejs.dev/blog/biome-v2-5/) |
| React 19.3 | 2026-09-09 | [GitHub release](https://github.com/react/react/releases/tag/v19.3.0) |
| React Compiler 1.0 | 2025-10-07 | [react.dev](https://react.dev/blog/2025/10/07/react-compiler-1) |
| Base UI 1.0 / shadcn default | 2025-12-11 / Jul 2026 | [shadcn changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default) |
| Storybook 10 | Oct 2025 (10.6.x current) | [storybook.js.org](https://storybook.js.org/blog/storybook-10/) |
| moon v2 | 2026-02-18 | [moonrepo.dev](https://moonrepo.dev/blog/moon-v2.0) |
| Vite+ beta | Aug 2026 | [VoidZero](https://voidzero.dev/posts/announcing-vite-plus-beta) |
| Knip v6 | 2026 (6.37.x in Sep) | [knip.dev](https://knip.dev/blog/knip-v6) |
