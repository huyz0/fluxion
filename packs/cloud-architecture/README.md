# @fluxion/pack-cloud-architecture

First-party cloud architecture symbols (FR-LIB-007), namespace `cloud`: 18 provider-neutral declarative definitions drawn
for Fluxion (MIT), with no vendor artwork, colours or names (ADR-0050). A host registers them like any plugin (ADR-0017),
or loads the declarative distribution in `pack/` (ADR-0048). Each service is a rounded tile with a stroke-only mark and
its label below; boundaries are dashed (region), dotted (zone) or dash-dot (private network), named at the top left.

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 18 shapes, declarative distribution in `pack/` |

| Category | Ids |
|---|---|
| `compute` | `compute`, `container`, `function`, `cluster` |
| `storage` | `object-storage`, `block-storage`, `database`, `cache` |
| `integration` | `queue`, `pub-sub`, `api-gateway` |
| `networking` | `cdn`, `dns` |
| `security` | `identity` |
| `operations` | `monitoring` |
| `boundaries` | `region`, `zone`, `private-network` |

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both, and `pack-versions.json` (each released version's category hashes), against the exported `cloudSource` with the SDK's
shared check (ADR-0193, ADR-0194). Changed geometry needs a new package version. Ordinary runs only compare, and `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run packs/cloud-architecture -u` rewrites them.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
