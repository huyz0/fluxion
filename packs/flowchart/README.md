# @fluxion/pack-flowchart

First-party flowchart shapes (FR-LIB-007), namespace `flowchart`: 25 declarative definitions drawn for Fluxion (MIT). A host
registers them like any plugin (ADR-0017), or loads the declarative distribution in `pack/` (ADR-0048):

```ts
import { flowchartPack } from '@fluxion/pack-flowchart';

flowchartPack.register(registries); // every shape, or diagnostics
```

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 25 shapes, declarative distribution in `pack/` |

| Category | Ids |
|---|---|
| `process` | `process`, `alternate-process`, `decision`, `terminator`, `predefined-process`, `preparation`, `manual-operation`, `delay` |
| `data` | `data`, `manual-input`, `document`, `multi-document`, `database`, `stored-data`, `internal-storage`, `queue`, `display`, `card` |
| `flow` | `connector`, `off-page-connector`, `merge`, `extract`, `summing-junction`, `or`, `annotation` |

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both, and `pack-versions.json` (each released version's category hashes), against the exported `flowchartSource` with the SDK's
shared check (ADR-0193, ADR-0194). Changed geometry needs a new package version. Ordinary runs only compare, and `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run -u packs/flowchart` rewrites them.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
