# @fluxion/pack-fonts-core — agent notes

First-party bundled fonts: Inter, Source Serif 4 and JetBrains Mono under OFL-1.1 (FR-THM-008); imports only @fluxion/sdk.

`fonts/` and `fonts.json` are vendored by `scripts/fonts/vendor.mjs` (never edit by hand; `--check` compares to the pinned @fontsource packages). `check-licenses` reads `fonts.json`.

## Rules

- Layer Pack: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- Import only `@fluxion/sdk` (and allowed peer libraries). No private back doors into other packages.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic, T1 (browser) for components.
