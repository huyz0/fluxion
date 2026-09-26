# @fluxion/sdk — agent notes

Public plugin API: stable contracts, manifest schema, component contract, test harness.

## Rules

- Layer L4: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- Follow the layer rules in docs/architecture/01-overview.md.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.
