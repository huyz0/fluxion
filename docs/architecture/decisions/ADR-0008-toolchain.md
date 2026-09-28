---
status: accepted
date: 2026-09-26
decision-makers: Fluxion maintainers
---

# ADR-0008 — Toolchain: pnpm 11 + Turborepo + Vite 8 + tsdown + strict TS (tsgo) + Biome 2 + Vitest + Playwright + Storybook + Changesets

## Context and Problem Statement

Fluxion is a ~20-package TypeScript monorepo, built mostly by AI agents working in tight loops
(research 06). The toolchain must be fast enough to run on every agent edit (quick gate < 30 s,
pre-commit < 120 s, NFR-DX-002), strict enough to replace human review bandwidth, cross-platform
(NFR-PORT-005), and supply-chain safe (NFR-SEC-005). Which tools?

## Decision Drivers

- Inner-loop speed (native tools), predictable config that agents rarely misconfigure.
- Strictness: strict TS, lint as errors, API reports, layering rules (NFR-MNT-001/002/007).
- One test runner for unit, browser-component and benchmarks; real browsers for E2E/visual/a11y.
- Supply chain: lockfile, release-age gating, tokenless publishing with provenance.
- Low lock-in; a coherent ecosystem.

## Considered Options

- Package manager: **pnpm 11** vs pnpm 12 (Rust rewrite) vs npm / Yarn 4 / Bun
- Task runner: **Turborepo** vs Nx vs moon
- Lint/format: **Biome 2** vs Oxlint + tsgolint + Oxfmt vs ESLint + typescript-eslint + Prettier
- Builds: **Vite 8** (apps, player single-file) + **tsdown** (libraries) vs tsup / unbuild
- Tests: **Vitest** + **Playwright** + **Storybook** vs Jest / Cypress
- Release: **Changesets** + npm trusted publishing vs semantic-release

## Decision Outcome

Chosen options:
- **pnpm 11** with catalogs and release-age gating (pnpm 12 is evaluated once the Rust rewrite
  settles; same lockfile, so migration is cheap).
- **Turborepo**; layering comes from dependency-cruiser, not Nx tags.
- **Vite 8** (Rolldown) for apps and the single-file player; **tsdown** for libraries.
- **TypeScript strict** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `isolatedDeclarations`, `erasableSyntaxOnly`), type-checked with **tsgo** (TS 7). TS 6 stays
  installed for API Extractor, TypeDoc and Stryker until TS 7.1 ships a stable API.
- **Biome 2** for lint and format (one binary, one config).
- **Vitest** (unit, browser mode, bench) + fast-check; **Playwright** (E2E, visual, axe);
  **Storybook** (editor UI, stories as tests); Stryker nightly.
- **Changesets** + OIDC trusted publishing.

Exact versions live in `docs/standards/tech-stack.md` and the catalogs.

### Consequences

- Good, because every inner-loop tool is native or near-native, so agents can run the full gate
  often.
- Good, because the stack is mainstream and well known to agents.
- Bad, because Biome's type-aware rules are weaker than Oxlint + tsgolint (for example, floating
  promises). Revisit if review keeps finding such misses.
- Bad, because the dual TS 6/7 install and pre-1.0 tsdown are temporary complexity.

### Confirmation

`check-budget` measures gate wall time. CI runs `pnpm verify` on Windows, macOS and Linux. The API
Extractor, size-limit, knip and license gates are required checks.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| pnpm 12 | faster Rust core | fresh rewrite; regressions risk — revisit |
| Nx / moon | enforced tags, generators | more surface than needed; agents misconfigure it more often |
| Oxlint + tsgolint + Oxfmt | strongest type-aware rules, fastest | two-three tools; Oxfmt beta at decision time |
| ESLint + typescript-eslint | richest ecosystem | slow; no TS 7 support |
| Jest / Cypress | familiar | second runner; no Vite-native browser mode |

## More Information

Research: `docs/research/05-engineering-stack-and-tooling.md` §0–§4, §8. Standards:
`../../standards/tech-stack.md`, `../../standards/ci-cd.md`, `../../standards/testing.md`.

## Amendments

- 2026-09-28 (ADR-0146, M4.3): mutation testing uses **tzap** (`@huyz0/tzap`), not StrykerJS,
  from M4 on: `pnpm mutate`, a nightly job and per-package floors. Stryker no longer needs the
  TS 6 pin.
