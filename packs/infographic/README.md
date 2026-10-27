# @fluxion/pack-infographic

First-party infographic pieces (FR-LIB-007), namespace `infographic`: 16 declarative definitions drawn for Fluxion (MIT)
to build SmartArt-like figures from ordinary elements. A host registers them like any plugin (ADR-0017), or loads the
declarative distribution in `pack/` (ADR-0048).

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 16 shapes, declarative distribution in `pack/` |

| Category | Ids |
|---|---|
| `charts` | `pie`, `donut`, `gauge`, `progress` (param `value`), `target` |
| `diagrams` | `venn`, `matrix` |
| `layers` | `funnel`, `funnel-layer` (param `taper`), `pyramid` |
| `labels` | `step-pill`, `number-badge`, `hexagon-tile`, `stat-card`, `banner`, `milestone` |

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both against the exported definitions with the SDK's shared suite (ADR-0193): `vitest -u` rewrites
them, and a second run checks the rewritten files.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
