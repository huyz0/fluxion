# Code structure

> Read when: adding a package, folder or file; a file nears 300 lines or a function nears 60;
> writing a package's README.md / AGENTS.md; unsure where code belongs.
> Family: Code · Related: [coding-typescript.md](coding-typescript.md), [tech-stack.md](tech-stack.md).

Goal: an agent working in one package can load that package's context and nothing else, and a
reviewer can judge a change without reading the rest of the repo. Package map and layers:
`docs/architecture/01-overview.md` §2.

## 1. Repository layout

```
fluxion/
├── packages/        @fluxion/* libraries (schema, geometry, core, …, editor, sdk, cli, mcp)
├── apps/            studio (Vite PWA), docs (Astro Starlight)
├── packs/           first-party plugins; import only @fluxion/sdk
├── tools/           dev-only packages (codemods, turbo gen templates, bench harness)
├── scripts/
│   └── gates/       quality gates as Node .mjs (thresholds.mjs, check-*.mjs, m<n>-complete.mjs)
├── examples/        sample decks and FluxScript used by docs, tests and evals
├── specs/           format and DSL specs, JSON Schema outputs, security corpus
├── docs/            architecture, requirements, research, standards, milestones, decisions
├── AGENTS.md        root agent instructions (CLAUDE.md imports it)
├── pnpm-workspace.yaml, turbo.json, biome.json, tsconfig.base.json, .dependency-cruiser.mjs
```

1. **Gates and repo scripts are Node `.mjs`, never bash** — Windows is a first-class dev host. →
   `check-portability` (CI OS matrix runs `pnpm verify`)
2. **Nothing at the root imports from `apps/`**; apps are leaves. → `check-layering`

## 2. Package layout

```
packages/routing/
├── package.json         name, exports map, "sideEffects": false
├── tsconfig.json        extends ../../tsconfig.base.json, project references
├── README.md            what it is, public API sketch, which layer, why it exists
├── AGENTS.md            invariants, do/don't, commands, gotchas for editors of this package
├── src/
│   ├── index.ts         public entry: explicit named re-exports ONLY
│   ├── orthogonal/      one folder per concept when it needs several files
│   │   ├── grid.ts
│   │   ├── grid.test.ts
│   │   └── nudge.ts
│   ├── anchors.ts
│   ├── anchors.test.ts  co-located unit test
│   └── __fixtures__/    input decks, golden SVG, recorded outputs
└── bench/               *.bench.ts (vitest bench), optional
```

3. **`src/index.ts` is the only public entry** and contains explicit `export { a, b } from
   "./file"` / `export type {…}` lines — no logic, no `export *`. Additional entries (e.g.
   `./worker`) are declared in `exports`. → Biome `noReExportAll` + `check-api`
4. **Tests are co-located** as `name.test.ts` (unit), `name.browser.test.ts` (Vitest browser),
   `name.prop.test.ts` (fast-check). E2E lives in the root `e2e/` (studio + player flows). → Vitest project globs
5. **Every package has README.md and AGENTS.md.** README is for users of the package; AGENTS.md is
   for whoever edits it (keep ≤ 60 lines). → no gate — `pnpm gen` creates both; review
6. **Internal helpers stay unexported** from `index.ts`; if another package needs them, promote
   them deliberately (API report diff). → knip + `check-api`

## 3. Size limits

| Unit | Limit | Gate |
|---|---|---|
| File | ≤ 400 lines (aim ≤ 300) | `check-size` |
| Function / method | ≤ 60 lines | `check-size` |
| Cyclomatic complexity | ≤ 12 per function | `check-size` |
| Parameters | ≤ 4; use an options object beyond | Biome `useMaxParams` |
| JSX component | ≤ 150 lines incl. hooks | `check-size` (function rule) |

7. **Limits are in `scripts/gates/thresholds.mjs` and only tighten.** No per-file exemptions
   except generated files listed there. → `check-drift`
8. **Split by concept, not by kind.** `anchors.ts` + `nudge.ts`, not `utils.ts` + `types.ts` +
   `helpers.ts`. A file named `utils`, `helpers`, `misc` or `common` is rejected. → `check-size`
   name denylist

## 4. Module boundaries

9. **Import only lower layers** (L0 < L1 < … < L5 < App) as listed in the package map. →
   `check-layering`
10. **Pure packages import no DOM, timers, network or `node:*`.** → `check-layering` + Biome
11. **`player` never imports `editor`.** The saved file embeds the player only. → `check-layering`
12. **`packs/*` import only `@fluxion/sdk`** and allowed peers (React). No back doors. →
    `check-layering`
13. **No deep imports** (`@fluxion/core/src/…`). Only `exports` entry points. → `check-layering` +
    `exports` map
14. **No circular imports**, within or across packages. → `check-layering` (`no-circular`)
15. **Dev-only code (fixtures, test harnesses) never reaches a runtime import.** → `check-layering`
    (`not-to-dev-dep`)

## 5. `exports` maps

Every package uses the same shape; internal consumers read source directly through a custom
condition, published consumers get `dist/`.

```jsonc
{
  "name": "@fluxion/routing",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": {
      "@fluxion/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./worker": { "@fluxion/source": "./src/worker.ts", "default": "./dist/worker.js" }
  },
  "files": ["dist"]
}
```

16. **ESM only**, `"type": "module"`, no `main`/`require` fields. → publint
17. **`sideEffects: false`** unless the package registers custom elements or CSS; then list the
    files. → publint + size-limit
18. **Types resolve for every entry.** → attw (`@arethetypeswrong/cli`) in `pnpm verify`

## 6. File naming

| Kind | Pattern | Example |
|---|---|---|
| Source | kebab-case `.ts` / `.tsx` | `screen-view.tsx` |
| CSS Module (content) | `name.module.css`, classes `fx-*` | `shape-view.module.css` |
| Unit / browser / property test | `.test.ts` / `.browser.test.ts` / `.prop.test.ts` | `nudge.prop.test.ts` |
| Story | `name.stories.tsx` next to component | `inspector-panel.stories.tsx` |
| Benchmark | `bench/name.bench.ts` | `bench/route-200.bench.ts` |
| Fixture | `__fixtures__/kebab-name.<ext>` | `__fixtures__/org-chart.flux.json` |

19. **File name = main export in kebab-case.** `screen-view.tsx` exports `ScreenView`. → review

## 7. Adding a package — checklist

1. ADR if it adds a layer, a runtime dependency in `player`, or a published package.
2. `pnpm gen package <name>` (turbo gen template) — never copy-paste another package.
3. Add it to the package map in `docs/architecture/01-overview.md` with layer and "may depend on".
4. Add its layer rule to `.dependency-cruiser.mjs`; run `node scripts/gates/check-layering.mjs`.
5. Add coverage floor to `thresholds.mjs` (pure ≥ 90/85, render/player ≥ 80, editor ≥ 70).
6. Add size-limit entry if it is published or bundled into the player.
7. Write README.md and AGENTS.md; add a changeset if publishable.
8. `pnpm verify` green.
