# @fluxion/pack-icons-lucide

First-party Lucide icons (FR-LIB-007), namespace `lucide` (for example `lucide:globe`): 185 icons curated from the pinned Lucide
Iconify collection in 18 library categories. A host registers them like any plugin (ADR-0017), or loads the declarative
distribution in `pack/` (ADR-0048).

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 185 icons, declarative distribution in `pack/` |

Categories: `infrastructure`, `devices`, `people`, `security`, `communication`, `files`, `places`, `transport`, `time`,
`commerce`, `charts`, `layout`, `status`, `actions`, `arrows`, `development`, `nature`, `health`.

## Source and licence

The artwork is Lucide's, unchanged: `scripts/packs/lucide.mjs` converts the names in `subset.json` from
`specs/import/corpus/iconify/lucide.json` (manifest source `iconify-lucide`) with the same Iconify importer and Node paint
witness a host uses (M18.18, M18.101), and writes `src/icons.json` with each icon's category and the upstream notice. The pack
credits Lucide Icons and Contributors (ISC) for every icon and Cole Bemis (MIT) for the icons Lucide's notice lists as derived
from Feather, resolved through the collection's aliases to their current names. The package's code is MIT (`LICENSE`);
`NOTICE` holds the complete upstream notice for the artwork.

To change the subset, edit `subset.json` (canonical names only, no aliases), run `pnpm run build` and
`node scripts/packs/lucide.mjs`, then rewrite the distribution as below.

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both, and `pack-versions.json` (each released version's category hashes), against the exported
`iconsLucideSource` with the SDK's shared check (ADR-0193, ADR-0194). Changed geometry needs a new package version. Ordinary
runs only compare, and `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run packs/icons-lucide -u` rewrites them.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
