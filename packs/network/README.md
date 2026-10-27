# @fluxion/pack-network

First-party network symbols (FR-LIB-007), namespace `network`: 14 generic declarative definitions drawn for Fluxion (MIT),
with no vendor artwork (ADR-0050). A host registers them like any plugin (ADR-0017), or loads the declarative distribution
in `pack/` (ADR-0048). Marks are stroke-only decorations; device and host symbols carry their label below.

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 14 shapes, declarative distribution in `pack/` |

| Category | Ids |
|---|---|
| `devices` | `router`, `switch`, `hub`, `load-balancer`, `access-point`, `modem` |
| `security` | `firewall`, `vpn` |
| `hosts` | `server`, `rack`, `storage` |
| `zones` | `internet`, `subnet`, `bus` |

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both, and `pack-versions.json` (each released version's category hashes), against the exported `networkSource` with the SDK's
shared check (ADR-0193, ADR-0194). Changed geometry needs a new package version. Ordinary runs only compare, and `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run -u packs/network` rewrites them.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
