# @fluxion/player — agent notes

Present runtime: navigation, clock and scheduler, transitions, trigger bus, interactions, overlays, responsive, speaker sync.

## Rules

- Layer L4: import only from lower layers (docs/architecture/01-overview.md); enforced by `check-layering`.
- DOM allowed. Business logic belongs in the pure packages below this layer.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.
