# @fluxion/docs — agent notes

Astro Starlight documentation site and llms.txt.

## Rules

- Layer App: import only from lower layers (docs/architecture/01-overview.md); enforced by `check-layering`.
- Follow the layer rules in docs/architecture/01-overview.md.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.
