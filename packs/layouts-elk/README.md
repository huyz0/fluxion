# @fluxion/pack-layouts-elk

Optional ELK layouts pack: elkjs (EPL-2.0) layered, stress and rectpacking as layouts-elk:*; registered only when installed (ADR-0045).

| Layer | Pure | Status |
|---|---|---|
| Pack | no | M17.20 — `registerElkLayouts(registry)` adds `layouts-elk:layered`, `:stress`, `:rectpacking`; elkjs loads lazily |

Architecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).

## Licence

The pack's code is MIT. It loads elkjs unmodified, used under EPL-2.0 (see [NOTICE](NOTICE)); `check-licenses` allows EPL-2.0 only here
(`LICENSES.packExceptions`). Nothing under `packages/` or `apps/` depends on it: a host that installs the pack calls `registerElkLayouts`
in the realm where layouts run.
