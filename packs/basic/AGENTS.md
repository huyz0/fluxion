# @fluxion/pack-basic — agent notes

First-party basic shape pack; imports only @fluxion/sdk.

## Rules

- Layer Pack: import only from lower layers (docs/architecture/01-overview.md); enforced by `check-layering`.
- Import only `@fluxion/sdk` (and allowed peer libraries). No private back doors into other packages.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.
