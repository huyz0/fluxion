# @fluxion/pack-people

First-party people symbols (FR-LIB-007), namespace `people`: 10 generic declarative avatars drawn for Fluxion (MIT), with no
likeness of a real person (ADR-0050). A host registers them like any plugin (ADR-0017), or loads the declarative distribution
in `pack/` (ADR-0048). Each is an outline frame holding stroke-only figures and badges; the label sits below.

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 10 shapes, declarative distribution in `pack/` |

| Category | Ids |
|---|---|
| `individuals` | `person`, `person-add`, `person-check`, `guest` |
| `groups` | `pair`, `group` |
| `roles` | `admin`, `developer`, `support`, `bot` |

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both, and `pack-versions.json` (each released version's category hashes), against the exported `peopleSource` with the SDK's
shared check (ADR-0193, ADR-0194). Changed geometry needs a new package version. Ordinary runs only compare, and `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run packs/people -u` rewrites them.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
