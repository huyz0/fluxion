# @fluxion/layout

Layout interface, built-in algorithms (`grid`, `stack`, `layered`), the synchronous pipeline with its post-passes (pins, overlap, snap), the worker
host, and the `layout.arrange` command.

| Layer | Pure | Status |
|---|---|---|
| L2 | yes | M13: engine v1 (the worker glue lives under `src/worker`, entry `@fluxion/layout/worker`) |

- `layoutSync({ input, algorithm, options?, seed? })` lays a snapshot out; the same input and seed give the same boxes and fingerprint.
- `registerBuiltInLayouts(registry)` registers `grid`, `layered` and `stack`; a pack adds `pack:name` layouts with `registerLayout`.
- `registerArrangeCommand(commands, layouts)` adds `layout.arrange` and `layout.applyBoxes`; `createAsyncArranger` lays a screen out in a worker.
- `buildSnapshot(records, request)` reads a layout input from document records.

Architecture: [05-layout-and-routing.md](../../docs/architecture/05-layout-and-routing.md); decisions
[ADR-0033](../../docs/architecture/decisions/ADR-0033-layout-engine-contract-v1.md), [ADR-0034](../../docs/architecture/decisions/ADR-0034-overlap-removal-and-determinism.md).
Saved files carry baked positions only: this package never enters the player (NFR-SIZE-005).
