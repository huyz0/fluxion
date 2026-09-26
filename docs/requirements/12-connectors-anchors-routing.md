# 12 — Anchors, Connectors & Routing

Areas: `ANC` (anchors), `CON` (connectors), `RTE` (routing), `RDR` (riders / sub-shapes on paths).

## ANC — Anchors (ports)

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-ANC-001 | M | R1 | Every shape exposes a **floating anchor** (connector end attaches to the nearest perimeter point toward the other end). | Moving either shape re-projects endpoint onto outline. |
| FR-ANC-002 | M | R1 | Shape definitions declare **named fixed anchors** as fractional coordinates (0..1) with optional outward direction; default set = 4 side midpoints + center. | Connector attached to `n` anchor stays at top-middle on resize/rotate. |
| FR-ANC-003 | M | R3 | Anchor kinds: `fixed` (point), `side` (any point along a side, slides to optimum), `perimeter` (floating), `center`; each with optional `maxConnections`, `direction`, `role` (in/out). | Unit tests per kind; `maxConnections` enforced in UI. |
| FR-ANC-004 | M | R3 | **Dynamic anchors**: when a connector uses `auto` anchor mode, the system chooses the best anchor per endpoint after layout (minimize length/bends/crossings, respect roles). | After layout, auto-anchored connectors have no avoidable crossings on fixtures. |
| FR-ANC-005 | S | R3 | Users can add/remove/move custom anchors on a shape instance. | Custom anchor persisted & connectable. |
| FR-ANC-006 | M | R3 | Anchors show on hover while connecting; snapping to anchors within tolerance; anchor labels in inspector. | E2E: drag connector end near anchor snaps. |
| FR-ANC-007 | S | R3 | Multiple connectors on a `side` anchor are **distributed** (spread evenly) instead of stacking. | 3 connectors on east side are spaced. |
| FR-ANC-008 | S | R6 | Component shapes can declare anchors programmatically and change them at runtime (e.g., a list component with one anchor per row). | Adding a row adds an anchor and existing connections persist by anchor id. |

## CON — Connectors

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-CON-001 | M | R0 | Connector element with `source` and `target` endpoints; each endpoint is either bound (`elementId` + `anchor`) or free (point). | Render straight line between bound shapes. |
| FR-CON-002 | M | R1 | Route types: `straight`, `curved` (bezier, auto control points), `orthogonal` (elbow), `polyline` (user waypoints). | Snapshot per route type. |
| FR-CON-003 | M | R1 | Markers (arrowheads) at start/end/mid: none, arrow, open-arrow, triangle, diamond, circle, bar, crow's-foot variants (ER), custom from pack. Size scales with stroke. | Each marker snapshot. |
| FR-CON-004 | M | R3 | Orthogonal routing avoids obstacles (other shapes) with configurable margin and minimal bends. | Fixture: no route segment intersects a non-endpoint shape. |
| FR-CON-005 | M | R1 | Connector style: stroke color/width/dash, opacity, line cap, corner rounding radius (for orthogonal/polyline), theme tokens. | Rounded corners render with given radius. |
| FR-CON-006 | M | R1 | Labels: one or more labels positioned by fraction along path (0..1) + offset, with rich text & background. | Label stays at 50 % after moving endpoints. |
| FR-CON-007 | M | R1 | Editing handles: drag endpoints to reattach, drag midpoints/segments to add waypoints or move orthogonal segments; curve control handles. | E2E for each. |
| FR-CON-008 | S | R3 | Line jumps (hops/gaps) where connectors cross, configurable per doc/connector. | Crossing produces arc hop in snapshot. |
| FR-CON-009 | S | R3 | Connector-to-connector binding (endpoint attaches to a point along another connector). | Moving host connector moves attached endpoint. |
| FR-CON-010 | S | R3 | Custom connector types from packs: path generator function + default style (e.g., "wavy", "zigzag", "double line", "pipe", "cable"). | Pack connector renders & routes. |
| FR-CON-011 | S | R3 | Parallel connectors between the same two shapes are auto-offset (bundled/fanned). | Two A→B connectors don't overlap. |
| FR-CON-012 | M | R1 | Connectors remain attached when shapes move, resize, rotate, group, or are laid out. | Property test: after random transforms endpoints lie on anchors. |
| FR-CON-013 | S | R4 | Connector gradient strokes and stroke along-path gradient. | Snapshot. |

## RTE — Routing engine

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-RTE-001 | M | R1 | Routers are pluggable by name (`straight`, `bezier`, `orthogonal`, `polyline`, custom). | Registering a router makes it selectable. |
| FR-RTE-002 | M | R3 | Incremental re-routing: moving a shape re-routes only affected connectors, within frame budget during drag. | Drag with 200 connectors stays ≥ 50 fps on reference machine. |
| FR-RTE-003 | S | R3 | Global routing pass (worker) that nudges parallel segments apart and minimizes crossings. | Fixture: overlapping collinear segments separated by ≥ spacing. |
| FR-RTE-004 | M | R3 | Routing is deterministic for identical input. | Same input → identical path output (snapshot). |

## RDR — Riders (sub-shapes following connectors)

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-RDR-001 | M | R4 | A connector can host **riders**: shapes/icons/components that move along its path. Rider config: shape ref, count, spacing, speed (px/s or duration), direction (forward/back/ping-pong), loop, easing, rotate-to-path, start offset, trail effect. | "Electron" rider: 5 dots at 40 px/s loop along an orthogonal wire. |
| FR-RDR-002 | M | R4 | Riders follow the live path (re-routing mid-animation keeps riders on path). | Moving a shape in edit preview keeps riders on path. |
| FR-RDR-003 | S | R4 | Riders can be triggered (start/stop/burst) by timeline steps and interactions. | Click node → burst of 10 riders. |
| FR-RDR-004 | S | R4 | Riders emit events at path end (`arrive`) usable as triggers (e.g., target pulses on arrival). | Target flashes when each rider arrives. |
| FR-RDR-005 | M | R4 | Performance: ≥ 500 simultaneous riders at 60 fps desktop / 200 at 55 fps mid-range mobile. | Benchmark in CI perf job. |
