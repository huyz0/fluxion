# @fluxion/pack-layouts-elk — agent notes

Optional ELK layouts pack: elkjs (EPL-2.0) layered, stress and rectpacking as layouts-elk:*; registered only when installed (ADR-0045).

## Rules

- Layer Pack: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- Import only `@fluxion/sdk` (and allowed peer libraries). No private back doors into other packages.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.
