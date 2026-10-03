# @fluxion/pack-themes-core — agent notes

First-party themes pack: eight built-in themes (FR-THM-003); imports only `@fluxion/sdk`.

## Rules

- Layer Pack: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- Import only `@fluxion/sdk` (and allowed peer libraries). No private back doors into other packages.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.
