---
status: accepted
date: 2026-09-26
decision-makers: harness (M1.5)
---

# ADR-0011 — Workspace source resolution and dual TypeScript compiler

## Context and Problem Statement

Packages import each other (`@fluxion/core` → `@fluxion/schema`). Type-checking and testing
should not require building every dependency first, but published packages must resolve to built
`dist/`. TypeScript 7.0 (the native compiler) type-checks about 10× faster, but it has no
compiler API yet, which TypeDoc and dependency-cruiser need (research 05; ADR-0008). (API Extractor,
first assumed to need it too, bundles its own compiler: amended in M1.14.)

## Decision Drivers

- Fast feedback for agents: `verify:fast` < 30 s (NFR-DX-002).
- One source of truth per package; no stale `dist/` during development.
- API reports and docs must keep working (NFR-MNT-007).

## Considered Options

1. **Build-first**: every consumer resolves `dist/`; turbo builds dependencies before typecheck/test.
2. **Custom export condition `@fluxion/source`** pointing at `src/index.ts`, enabled via
   `customConditions` in `tsconfig.base.json` and via `resolve.conditions` in Vitest/Vite;
   published consumers ignore it and get `dist/`.
3. TypeScript `paths` aliases to `src/`.

## Decision Outcome

**Option 2.** Each package's `exports["."]` is
`{ "@fluxion/source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }`.
Tools inside the repo resolve source; published consumers resolve `dist`. `paths` (option 3) was
rejected because it leaks into emitted declarations and duplicates the package graph.

**Dual compiler:** `typescript@7` (catalog `typescript`) runs `tsc -b` for type-checking
and project references. Tools that need a compiler API use TypeScript 6 until TS 7.1 ships one:
TypeDoc through `apps/docs`, which installs `typescript` from the named catalog `typescript6`
(`npm:typescript@6.0.3`) so TypeDoc's peer resolves to it (M1.14); dependency-cruiser through its own
`packageExtensions` dependency (M1.11). API Extractor bundles its own compiler (5.9 today) and reads the
**emitted** `.d.ts` files, so it needs neither (M1.14). `isolatedDeclarations` keeps
declaration output simple enough for every tool that reads it.

## Consequences

- Good: no build step before typecheck or unit tests; turbo caches builds for packaging only.
- Good: the fast compiler serves the hot path; API tooling keeps working.
- Bad: two TypeScript versions in the lockfile; revisit when TS 7.1 has a stable API (Renovate
  groups both).
- Bad: every tool that resolves packages must set the `@fluxion/source` condition (Vite, Vitest,
  Storybook, dependency-cruiser); missing it shows up as "cannot find dist/index.js" in tests.

## Confirmation

`tests/harness/tsconfig-strict.test.mjs` checks strictness; `workspace-shape.test.mjs` (M1.6)
checks every package's `exports` map has the three conditions; `check-api` (M1.14) runs API
Extractor (its bundled compiler) on the emitted declarations and TypeDoc on TS 6.

## Amendments

- 2026-09-26 (M1.11): dependency-cruiser also needs the TS 6 compiler API; it gets TS 6 through `packageExtensions`.
- 2026-09-26 (M1.14): API Extractor bundles its own compiler and reads the emitted `.d.ts`, so it needs no TS 6; TypeDoc gets TS 6 as `apps/docs`' own `typescript` from the named catalog `typescript6`.
- 2026-09-27 (M1.37): one TS 6 version string: `pnpm-workspace.yaml` declares `npm:typescript@6.0.3` once, YAML-anchored as `&typescript6` in dependency-cruiser's `packageExtensions` entry, and the `typescript6` catalog reuses it (`*typescript6`). pnpm rejects a `catalog:` specifier inside `packageExtensions`, so the catalog cannot be the source. The Decision Outcome text above was corrected in place in M1.11/M1.14, before the amendment policy (documentation.md rule 8) existed.
