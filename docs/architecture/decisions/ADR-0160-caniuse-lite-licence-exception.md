---
status: accepted
date: 2026-10-06
decision-makers: harness (M9.19; widens the licence policy by one package, which `check-drift` treats as weakening)
---

# ADR-0160 — `caniuse-lite` (CC-BY-4.0) is allowed as a transitive of `@lingui/core`

## Context and Problem Statement

ADR-0023 chose `@lingui/core` and `@lingui/react` as runtime dependencies of the editor and noted that both declare `@lingui/babel-plugin-lingui-macro`, a Babel plugin package, as a dependency, "nothing of it bundled into any app". `check-licenses` lists the editor's production dependencies transitively. Through `@babel/core` → `browserslist` the list now holds `caniuse-lite@1.0.30001812`, licensed **CC-BY-4.0**, which is not in `LICENSES.allow`, so the gate fails for shipped code.

## Considered Options

1. Add CC-BY-4.0 to `LICENSES.allow`: every future CC-BY-4.0 package would pass. Too wide.
2. Remove the Babel chain with a pnpm override: it replaces a package Lingui declares with something we do not test.
3. Allow CC-BY-4.0 for this one package.

## Decision Outcome

Option 3: `LICENSES.packageExceptions` maps a package name to the licences allowed for it; its one entry is `'caniuse-lite': ['CC-BY-4.0']`. `caniuse-lite` is browser-support data under an attribution licence (tech-stack.md §3 rule 1 already allows CC-BY-4.0 for content assets). It is reached only through the Babel plugin that `@lingui/core` declares; nothing of ours imports Babel, `browserslist` or `caniuse-lite`, and none of it reaches a bundle (the size-limit of the editor and the studio build confirm it). Attribution is met by the package's own licence file in `node_modules` and by a line in `NOTICE`. `check-drift` reports a new or widened package exception as a weakening, so another one needs its own ADR and a `Threshold-change:` trailer.

## Consequences

- Good: the licence gate stays strict for everything else; the exception names one package.
- Bad: a pnpm install of the editor's production tree contains a CC-BY-4.0 data package that nobody ships.

## Confirmation

`tests/harness/drift.test.mjs`: "fails on the licence policy weakening: a package exception added (NFR-LIC-002)" and "…widened"; `node scripts/gates/check-licenses.mjs` passes on the repository.
