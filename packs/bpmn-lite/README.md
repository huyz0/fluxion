# @fluxion/pack-bpmn-lite

First-party BPMN-lite notation (FR-LIB-007), namespace `bpmn`: 19 declarative definitions drawn for Fluxion (MIT). A host
registers them like any plugin (ADR-0017), or loads the declarative distribution in `pack/` (ADR-0048). Event kinds differ
by border (thin start, double intermediate, thick end) and inner mark; gateway and sub-process markers are stroke-only
decorations.

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 19 shapes, declarative distribution in `pack/` |

| Category | Ids |
|---|---|
| `activities` | `task`, `subprocess`, `call-activity`, `transaction` |
| `events` | `start-event`, `intermediate-event`, `end-event`, `timer-event`, `message-event` |
| `gateways` | `exclusive-gateway`, `parallel-gateway`, `inclusive-gateway`, `event-gateway` |
| `data` | `data-object`, `data-store` |
| `swimlanes` | `pool`, `lane` |
| `artifacts` | `group`, `annotation` |

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both, and `pack-versions.json` (each released version's category hashes), against the exported `bpmnSource` with the SDK's
shared check (ADR-0193, ADR-0194). Changed geometry needs a new package version. Ordinary runs only compare, and `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run packs/bpmn-lite -u` rewrites them.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
