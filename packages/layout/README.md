# @fluxion/layout

Layout interface, the fourteen built-in layouts, the smart templates, the synchronous pipeline with its post-passes (pins, constraints, overlap, fit, snap),
the worker host, and the `layout.arrange` command.

| Layer | Pure | Status |
|---|---|---|
| L2 | yes | M13: engine v1 (the worker glue lives under `src/worker`, entry `@fluxion/layout/worker`); M17: layout suite v2 and smart templates |

- `layoutSync({ input, algorithm, options?, seed? })` lays a snapshot out; the same input and seed give the same boxes and fingerprint.
- `registerBuiltInLayouts(registry)` registers every layout below; a pack adds `pack:name` layouts with `registerLayout`.
- `registerArrangeCommand(commands, layouts)` adds `layout.arrange` and `layout.applyBoxes`; `createAsyncArranger` lays a screen out in a worker.
- `buildSnapshot(records, request)` reads a layout input from document records.

## Layouts

`grid`, `stack`, `layered` (the default; dagre) from M13, then, all own code with no new dependency (ADR-0045):

| id | Lays out |
|---|---|
| `tree`, `orgchart` | A tidy tree for variable box sizes, in four directions |
| `radial` | The tree's breadth order on rings |
| `mindmap` | Two balanced sides around the root |
| `force` | Seeded Fruchterman–Reingold; the same seed gives the same boxes |
| `circular` | One ring in model order, or one per `hints.partition` |
| `packing` | Skyline bin packing into the frame's width |
| `timeline` | Nodes along an axis by `hints.date`, lanes by `hints.lane` |
| `swimlane` | `layered` inside each lane, then a lane pass |
| `tidy` | Minimal-movement cleanup: align near-aligned runs, snap starts to the grid, remove overlap with each move bounded |
| `fit` | Scale the unpinned boxes down together and move them into the safe area (`safeAreaOf`, `screenFrame`) |

The pipeline's post-passes run in order: pins, constraints (`align`, `sameRank`, `order`, `spacing`), overlap removal, fit when asked, snap.
Incremental mode moves at most `LAYOUT_INCREMENTAL_MOVED_PCT` % of the nodes when one is added (`movedPercent`, `reconcile`).

## Smart templates

`process.basic`, `process.chevron`, `cycle.basic`, `hierarchy.org`, `pyramid`, `matrix.2x2`, `venn`, `funnel`, `timeline.milestones` and `comparison`
build shapes and connectors from an items list (`buildTemplate`, `registerBuiltInTemplates`); the DSL and the AI call them by `template: <id>`.
`examples/dsl/templates-all.flux.yaml` draws all ten into a committed SVG golden.

Architecture: [05-layout-and-routing.md](../../docs/architecture/05-layout-and-routing.md); decisions
[ADR-0033](../../docs/architecture/decisions/ADR-0033-layout-engine-contract-v1.md), [ADR-0034](../../docs/architecture/decisions/ADR-0034-overlap-removal-and-determinism.md).
Saved files carry baked positions only: this package never enters the player (NFR-SIZE-005).
