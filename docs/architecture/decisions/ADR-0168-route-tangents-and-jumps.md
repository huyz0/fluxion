---
status: accepted
date: 2026-10-20
decision-makers: harness (M16.20; within FR-CON-007, FR-CON-011; no requirement changes; the schema change is a minor bump with a migration)
---

# ADR-0168 — Curve tangents and the jump style on a connector's route

## Context and Problem Statement

A `curved` route leaves each end along its anchor's direction and, through waypoints, takes Catmull-Rom tangents. The author can bend it only by adding waypoints; there is no handle to change how steeply the curve leaves a point. M16.12 drew hops where connectors cross, with the style set for the whole document; a single connector cannot ask for a gap or for none. Both need a field on the route, which is part of the file format.

## Decision Drivers

- A saved document keeps opening: the change is additive.
- A tangent is the author's intent, so it is saved with the file, and other tools can read it.
- A route that carries no tangent draws exactly as it does today.

## Considered Options

1. **Keep tangents out of the file; derive them from waypoints only.** No schema change, but a curve cannot be shaped without moving the points it passes through.
2. **`route.tangents`: a sparse record of offsets by route-point index (chosen), and `route.jumps`.**
3. **Two control points per leg, as in an SVG cubic.** Fully general, but every waypoint move would have to drag four numbers along, and a smooth join would have to be kept by the editor, not by the data.

## Decision Outcome

Option 2.

**Schema.** `Route` gains two optional fields:

- `tangents`: `{ [index]: { x, y } }`, the index being that of the route point in the list *source, waypoints..., target* (`"0"` the source, `"1"` the first waypoint, the last the target). The value is the offset from the point to its control point, in page units. At the source it is the control point the first leg leaves by; at the target, the one the last leg arrives by; at a waypoint it is the control point the next leg leaves by, and the leg before arrives against it (the join is smooth). A point without an entry keeps the default tangent.
- `jumps`: `arc` | `gap` | `none`, how this connector's crossings with others are drawn; absent follows the document's setting.

Only the `curved` router reads `tangents`; another type keeps them in the file and ignores them, so switching the type back and forth loses nothing.

**Migration.** `1.4 → 1.5` changes nothing but the version, except that a connector route carrying a `tangents` or `jumps` the typed fields refuse (the records are loose, so a 1.4 file may) loses those two fields, as 1.3 → 1.4 did for anchors.

**Editor.** A selected curved connector shows a handle at each route point's control point; dragging one writes its entry, one undo step.

## Consequences

- Good: the default curve is unchanged; a handle moves one number pair.
- Good: the lean (player) reader opens 1.4 files unchanged, as they only lack optional fields.
- Bad: a tangent is an absolute offset, so it does not scale with the leg when a point moves; the author drags it again.

## Confirmation

`schema-1-5.test.ts` (migration, fixture round-trip, validation), `curved.test.ts` (the router), `connector-handles.test.ts` and `e2e/connectors.tangent.spec.ts` (the handle and its one undo step).
