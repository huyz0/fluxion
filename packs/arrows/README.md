# @fluxion/pack-arrows

First-party block arrows (FR-LIB-007), namespace `arrows`: 18 declarative definitions drawn for Fluxion (MIT). A host
registers them like any plugin (ADR-0017), or loads the declarative distribution in `pack/` (ADR-0048).

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 18 shapes, declarative distribution in `pack/` |

| Category | Ids |
|---|---|
| `straight` | `right`, `left`, `up`, `down`, `left-right`, `up-down`, `quad`, `notched-right`, `striped-right` (params `head`, `shaft`) |
| `process` | `chevron`, `pentagon` (param `point`) |
| `bent` | `bent-right`, `bent-up`, `u-turn`, `curved-right`, `circular` |
| `callout` | `callout-right`, `split` |

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both against the exported definitions with the SDK's shared suite (ADR-0193): `vitest -u` rewrites
them, and a second run checks the rewritten files.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
