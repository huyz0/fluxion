---
status: accepted
date: 2026-10-17
decision-makers: harness (M16.2; within FR-ANC-003 to FR-ANC-007; no requirement changes; the schema change is a minor bump with a migration)
---

# ADR-0043 — Anchor model and auto-selection: four anchor kinds, scored choice with hysteresis, distribution along a side

## Context and Problem Statement

Today an `AnchorDef` is a named point (`name`, `x`, `y`, `dir`, `role`, `max`). FR-ANC-003 asks for fixed, side, perimeter and center anchors with limits and roles; FR-ANC-004 for an `auto` anchor that picks the best side after layout; FR-ANC-007 for several connectors on one side to spread out. The choice must not flicker while the user drags.

## Decision Drivers

- A saved document keeps opening: the change is additive.
- The choice is a pure function of geometry and options, so it is testable and deterministic.
- No visual jumps during a drag.

## Considered Options

1. **Keep named points only; model sides as sets of points.** No schema change, but a side with N connectors needs N pre-made points.
2. **Add a `kind` to `AnchorDef` (chosen).** `fixed` (today's behaviour and the default), `side` (a side of the box, with a position along it), `perimeter` (a fraction of the outline's length) and `center`.
3. **Compute everything in the router and keep the schema as is.** Hides the user's intent from the file and from other tools.

## Decision Outcome

Option 2.

**Schema.** `AnchorDef` gains optional `kind` (`fixed` | `side` | `perimeter` | `center`, default `fixed`), plus `side` (`n`|`e`|`s`|`w`) for `side` and `t` (0 to 1) for `side` and `perimeter`. `role`, `dir` and `max` apply to every kind. The `max` field is `maxConnections`. This is a minor schema bump: a document without `kind` reads as `fixed`, and the migration adds nothing but the version.

**Resolution.** Each kind resolves to a point and an outward normal in the element's box, mapped through its placement as today (`anchor.ts`).

**Auto selection.** `auto` generates the four side midpoints (plus outline corners for diamonds and ellipses) and the floating projection. A candidate pair costs the weights of 05-layout-and-routing.md §8 (length, bends, pointing away, crowding, role mismatch). The weights are router options with those defaults. A hysteresis term of about 15 % of the current best cost is added to every candidate other than the previous choice, so a side changes only when another is clearly better. While a drag is in progress the choice is frozen, and it is re-scored on drop. An algorithm-assigned side (for example from ELK) gets a strong bonus.

**Distribution and spill.** Connectors on one side are sorted by the far end's coordinate and spaced evenly. When a side holds `max` connectors, the next one spills to the adjacent side.

### Consequences

- Good: the user's intent is in the file; the pure selector is easy to test on fixtures.
- Good: hysteresis plus freeze-during-drag removes flicker.
- Bad: the weights are guesses until tuned on fixtures; they are options so a pack can change them.
- Bad: one more minor schema version; a fixture round-trip and a migration test are required (check-api, format fixtures).

### Confirmation

M16.4 (`anchors.test.ts`, migration fixture), M16.8 (`auto-anchor.test.ts`, crossings metric 0 on the `auto-anchors` fixtures), M16.9 (distribution and spill), M16.17 (editor snap and custom anchors).

## More Information

05-layout-and-routing.md §8, FR-ANC-003 to FR-ANC-007, ADR-0042.
