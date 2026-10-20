---
status: accepted
date: 2026-10-21
decision-makers: harness (M17.2; within FR-LAY-003, FR-LAY-006, FR-LAY-011 and NFR-LIC-002; no requirement changes)
amends: ADR-0005 (its default layout libraries)
---

# ADR-0045 — Layout suite v2: own pure algorithms, ELK only as a pack

## Context and Problem Statement

M17 adds eight layouts to `@fluxion/layout` (`tree`/`orgchart`, `radial`, `mindmap`, `force`, `circular`, `packing`, `timeline`,
`swimlane`) and a constraints post-pass (pins, `align`, `sameRank`, `order`, `spacing`). The M17 plan named backing libraries:
`d3-hierarchy` + `d3-flextree` for the trees, `d3-force` for force, WebCola for constraints and tidy. `@fluxion/layout` is a pure
package (NFR-MNT-001: no DOM, timers, clock, randomness or network) whose results must be the same on every host for the same seed
(ADR-0034), and every shipped dependency must carry an allowed licence (`scripts/gates/thresholds.mjs` `LICENSES.allow`).

## Decision Drivers

- Licence: `LICENSES.allow` is MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, MPL-2.0; EPL only inside a pack (`packExceptions`).
- Purity: no module of the package may start a timer, read a clock or touch the DOM, also not at import time.
- Determinism: the same input and seed give the same boxes on Linux, Windows and macOS (ADR-0034's sfc32 stream, `rng.ts`).
- Variable node sizes: diagram nodes are boxes of their own size, not points on a fixed grid.
- Size: the editor bundle carries the layouts; the player carries none of them.

## Considered Options

1. **The plan's libraries** (`d3-hierarchy`, `d3-flextree`, `d3-force`, WebCola).
2. **Own implementations of each algorithm in `@fluxion/layout`, no new dependency; ELK as an optional pack (chosen).**
3. **ELK for everything** (layered, stress, rectpacking, radial, tree).

## Decision Outcome

Option 2. This **amends ADR-0005**: its defaults `d3-hierarchy` + `d3-flextree`, seeded `d3-force` and WebCola are replaced by
the own code below; its pipeline, `@dagrejs/dagre` for layered and the optional ELK and libavoid packs stand.

| Layout | Algorithm (own code) | Why not the plan's library |
|---|---|---|
| `tree`, `orgchart` | Non-layered tidy tree for variable sizes (van der Ploeg 2014, linear-time Walker), direction `down`/`up`/`left`/`right` by rotating the result | `d3-flextree` is WTFPL, not in `LICENSES.allow`; `d3-hierarchy`'s `tree` assumes one node size |
| `radial` | The tidy tree's breadth order on rings: depth → radius from the largest box of each ring, angle by leaf count | uses the tree above |
| `mindmap` | The root's subtrees split into two sides by greedy balance of subtree heights, each side a `left`/`right` tidy tree | uses the tree above |
| `force` | Fruchterman–Reingold with a fixed iteration count, start positions from the run's `createRng(seed)`, nodes and edges sorted by id, coordinates quantized to 0.5 px each iteration; rectangle repulsion by box distance | `d3-force` imports `d3-timer` (timers at module load) and its float order depends on simulation internals we do not own |
| `circular` | Nodes on one circle in model order (or by a `hints.partition` per circle), radius from the summed box diagonals | none named |
| `packing` | Skyline bin packing of boxes into the frame's width, largest-area first, ties by id | none named |
| `timeline` | Nodes ordered by `hints.date` (else model order) along the axis, lanes from `hints.lane`, a row per lane | none named |
| `swimlane` | `layered` (dagre, as today) inside each lane, then a lane pass that stacks lanes and keeps every node inside its lane | none named |
| constraints post-pass, `tidy` | Projection: pins fixed, then `align`/`sameRank` snap to the median coordinate, `order` swaps along an axis, `spacing` min/max by a 1-D sweep, then the existing overlap removal (`overlap.ts`) with displacement bounded per node | WebCola pulls `d3-drag`, `d3-shape` and `d3-timer` v1 (DOM and timers) and solves in an order we cannot pin across hosts |

All live in `packages/layout/src/`, take randomness only from `createRng`, and register through `registerLayout` with Zod options and
capabilities like the M13 layouts. No new runtime dependency enters `@fluxion/layout`.

**ELK** (`elkjs`, EPL-2.0 OR GPL-3.0-or-later, used under EPL-2.0) lives only in `packs/layouts-elk`: unmodified, loaded lazily in a
worker chunk, its NOTICE shipped with the pack, the pack listed under `LICENSES.packExceptions` (already there). It registers
`layouts-elk:layered`, `layouts-elk:stress` and `layouts-elk:rectpacking` when installed (the `<pack>:<name>` form
`LAYOUT_TYPE` in `packages/schema/src/records/layout-spec.ts` accepts); nothing in `packages/` imports it.

### Consequences

- Good: no licence exception in core; the package stays pure and its results are bit-stable for a seed; the player is unaffected.
- Good: each algorithm is small enough to test with a property suite (no overlap, pins fixed, inside lane, inside frame).
- Bad: more own code to maintain than a dependency; the tidy tree and the projection need their own tests and benches (M17 rows 3, 8, 18).
- Bad: our force layout is plainer than `d3-force`'s many forces; a pack can add a richer one later through the same registry.

### Confirmation

`check-licenses` passes with `elkjs` only in `packs/layouts-elk/package.json` (m17 gate); `check-layering` keeps `@fluxion/layout` pure;
the force determinism test runs on all three CI operating systems; the 500-node benches stay under `LAYOUT_500_NODES_MS`.

## More Information

- Revisit when a permissively licensed variable-size tree or constraint solver appears that is pure at import, or when a layout
  needs a force the own `force` cannot express.
- Deviates from the M17 plan's "Decide before coding" libraries; the plan is a hypothesis (skill `plan-milestone`), this ADR is the decision.
