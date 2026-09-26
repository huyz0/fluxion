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
compiler API yet, which API Extractor and TypeDoc need (research 05; ADR-0008).

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
and project references; `typescript@6` (catalog `typescript6`, `npm:typescript@6.0.3`, added to the catalog by M1.14 when API Extractor is installed) is used only
by API Extractor, TypeDoc and dependency-cruiser (its own dependency via `packageExtensions`, M1.11) until TS 7.1 ships a compiler API. `isolatedDeclarations` keeps
declaration output simple enough for both.

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
Extractor on TS 6.
