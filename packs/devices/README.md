# @fluxion/pack-devices

First-party device symbols (FR-LIB-007), namespace `devices`: 15 generic declarative definitions drawn for Fluxion (MIT), with
no vendor artwork or product likeness (ADR-0050). A host registers them like any plugin (ADR-0017), or loads the declarative
distribution in `pack/` (ADR-0048). Marks are stroke-only decorations; every device carries its label below.

| Layer | Pure | Status |
|---|---|---|
| Pack | data | M18: 15 shapes, declarative distribution in `pack/` |

| Category | Ids |
|---|---|
| `computers` | `desktop`, `laptop` |
| `mobile` | `phone`, `tablet`, `watch` |
| `peripherals` | `printer`, `keyboard`, `mouse`, `camera`, `usb-drive` |
| `media` | `tv`, `speaker` |
| `iot` | `sensor`, `iot-device`, `thermostat` |

`pack/` holds `index.json` and one hashed file per category; `__golden__/` holds one normalized SVG per definition.
`src/pack.test.ts` checks both, and `pack-versions.json` (each released version's category hashes), against the exported `devicesSource` with the SDK's
shared check (ADR-0193, ADR-0194). Changed geometry needs a new package version. Ordinary runs only compare, and `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run packs/devices -u` rewrites them.

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).
