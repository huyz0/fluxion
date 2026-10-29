# @fluxion/pack-uml

First-party UML-lite notation (FR-LIB-007), namespace `uml`: 20 declarative definitions drawn for Fluxion (MIT). A host
registers them like any plugin (ADR-0017), or loads the declarative distribution in `pack/` (ADR-0048). Compartment lines
and inner marks are stroke-only decorations; named text regions hold each compartment's text.

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 20 shapes, declarative distribution in `pack/` |

| Category | Ids |
|---|---|
| `structure` | `class`, `interface`, `object`, `package`, `component`, `node`, `artifact`, `note`, `provided-interface` |
| `use-case` | `actor`, `use-case`, `system-boundary` |
| `sequence` | `lifeline`, `activation`, `fragment` |
| `state` | `state`, `initial`, `final`, `choice`, `fork` |

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both, and `pack-versions.json` (each released version's category hashes), against the exported `umlSource` with the SDK's
shared check (ADR-0193, ADR-0194). Changed geometry needs a new package version. Ordinary runs only compare, and `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run packs/uml -u` rewrites them.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
