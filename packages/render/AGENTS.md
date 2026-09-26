# @fluxion/render — agent notes

React 19 DOM+SVG renderer of a screen, identical in edit and present mode.

## Rules

- Layer L3: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- DOM allowed. Business logic belongs in the pure packages below this layer.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.
