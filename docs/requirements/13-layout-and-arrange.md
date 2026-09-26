# 13 — Layout & Arrange

Areas: `LAY` (auto layout), `ARR` (arrange: group, align, distribute, snap, z-order).

## LAY — Auto layout

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-LAY-001 | M | R2 | Layout algorithms are pluggable by name with typed options and a common interface (input: nodes with sizes/anchors/constraints, edges; output: positions, optional routes). | Registering a custom layout makes it available in UI, DSL and CLI. |
| FR-LAY-002 | M | R2 | Built-in: `layered` (hierarchical/flow, direction TB/LR/BT/RL), `grid`, `stack` (row/column with gap/align/wrap). | Fixtures produce non-overlapping results with configured spacing. |
| FR-LAY-003 | M | R3 | Built-in: `tree` (tidy tree, org chart), `radial`, `force` (seeded), `mindmap` (two-sided), `circular`, `timeline` (horizontal/vertical with lanes), `swimlane`, `packing` (rect packing). | Snapshot fixtures per algorithm. |
| FR-LAY-004 | M | R2 | **No overlap guarantee**: after any layout, no two non-grouped shapes overlap (respecting margins) and connector labels do not overlap shapes where the router supports it. | Property test over random graphs: overlap count = 0. |
| FR-LAY-005 | M | R2 | Layout scope: whole screen, a selection, a group/container (nested layouts; child containers laid out first, bottom-up). | Nested container fixture lays out correctly. |
| FR-LAY-006 | M | R3 | Constraints: pinned nodes (fixed), relative constraints (align, same rank, order), min/max spacing; incremental mode preserving the mental map. | Pinned nodes do not move; incremental change moves ≤ 30 % of nodes on fixture. |
| FR-LAY-007 | M | R2 | Layouts run off the main thread (worker) with cancellation; UI remains responsive. | 500-node layered layout completes < 2 s and main-thread long tasks < 50 ms. |
| FR-LAY-008 | M | R2 | Layout is **deterministic** given the same input & seed. | Snapshot equality across runs. |
| FR-LAY-009 | M | R4 | Layout changes are **animated** (positions, sizes, connector paths interpolated) in edit and present modes. | Visual test: frames interpolate; no connector detaches. |
| FR-LAY-010 | S | R3 | **Live layout containers**: a container with an attached layout re-lays out automatically on content change (add/remove/resize child). | Adding a node to a live tree container re-lays out. |
| FR-LAY-011 | S | R3 | "Tidy up" command: minimal-movement cleanup (snap to grid, align near-aligned, remove overlaps) without full re-layout. | Messy fixture → aligned result, max displacement bounded. |
| FR-LAY-012 | S | R3 | "Fit to screen": scale/position laid-out content to fit screen safe area. | Result within safe area. |
| FR-LAY-013 | S | R7 | **Responsive re-layout**: per breakpoint (e.g. portrait), a screen may specify an alternative layout (e.g. LR→TB) computed automatically. | Portrait view of LR flow renders TB, no overlap. |
| FR-LAY-014 | S | R3 | Smart templates ("SmartArt-like"): named layout presets with styling (process, cycle, hierarchy, pyramid, matrix, venn, funnel, timeline, comparison) selectable by name from DSL/AI. | Each template renders from a list of items. |

## ARR — Arrange

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-ARR-001 | M | R1 | Group/ungroup (nested groups); group transforms apply to children; enter group to edit child (double-click). | Group move/resize/rotate; child editing. |
| FR-ARR-002 | M | R1 | Align selection: left, center, right, top, middle, bottom — relative to selection, key object, or screen. | Unit tests per mode. |
| FR-ARR-003 | M | R1 | Distribute: horizontal/vertical by spacing or centers; tidy to equal gaps. | Unit tests. |
| FR-ARR-004 | M | R1 | Z-order: bring to front/forward, send backward/to back; fractional index ordering. | Order persists; minimal record changes. |
| FR-ARR-005 | M | R1 | Snapping: grid, other shapes' edges/centers (smart guides with distance indicators), screen center/edges, rotation increments. Toggleable; Alt disables temporarily. | E2E: guides appear; snapped position exact. |
| FR-ARR-006 | S | R3 | Frames/containers: shapes that clip and contain children (e.g., swimlane, card, section), children move with container. | Moving container moves children; clip on. |
| FR-ARR-007 | S | R3 | Match size (width/height/both), same style (format painter). | Unit tests. |
| FR-ARR-008 | S | R3 | Layers panel (tree of elements) with visibility/lock toggles and drag-reorder. | Reorder via panel changes z-order. |
