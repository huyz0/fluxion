# @fluxion/pack-callouts

First-party callouts (FR-LIB-007), namespace `callouts`: 13 declarative definitions drawn for Fluxion (MIT). A host
registers them like any plugin (ADR-0017), or loads the declarative distribution in `pack/` (ADR-0048). Every tail stays
inside its box, so selection and hit bounds cover the whole outline.

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 13 shapes, declarative distribution in `pack/` |

| Category | Ids |
|---|---|
| `speech` | `speech-rect`, `speech-rounded`, `speech-oval`, `speech-left` (param `tail`), `thought`, `shout` |
| `annotation` | `line`, `sticky-note`, `brace`, `bracket` |
| `label` | `tag`, `pin`, `quote` |

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both against the exported definitions with the SDK's shared suite (ADR-0193): ordinary runs only compare
(a missing, extra or changed file fails), and `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run -u packs/callouts` rewrites them.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
