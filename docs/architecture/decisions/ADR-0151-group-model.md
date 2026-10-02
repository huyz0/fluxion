---
status: accepted
date: 2026-10-02
decision-makers: harness (M8.34; within FR-ARR-001; records the model M8.4 and M8.5 built and the checkpoint review cp1 finding F3)
---

# ADR-0151 — A group's members keep their screen coordinates and its box follows them

## Context and Problem Statement

FR-ARR-001 said "group transforms apply to children". Read literally, that is the scene-graph model: a child's transform is
relative to its parent, so moving, resizing or rotating the group changes one record and every child follows. M8.4 and M8.5
built the other model, and the checkpoint review (cp1, F3) found the requirement text and the code disagree. One of them
must change, and the choice touches the file format (02-document-model), connectors, snapping and the player, so it is
recorded.

## Decision Drivers

- Connectors bind to elements and are routed from their screen boxes; a binding must not depend on a chain of parent
  transforms, least of all rotated ones (FR-CON-012).
- Grouping and ungrouping must not move anything (FR-ARR-001: a round trip restores every child within 1e-6).
- Every consumer (render, hit-test, snapping, exporters, the DSL, AI patches) reads a box from one record.
- One edit, one command, minimal diffs (ADR-0014); an undo step covers a group edit whole.

## Considered Options

1. **Relative transforms.** A child's `transform` is in its parent's frame; the group's transform is applied to all
   children. Moving a group is one record change. Every reader must compose the chain (rotated nested groups included),
   grouping rewrites every member, and bindings and snapping need world boxes recomputed on each read.
2. **Screen coordinates plus a derived group box.** A member's `transform` is always in screen coordinates. A group is a
   container element whose box is the bounds of its members and is refitted by an integrity hook in the transaction that
   changes them. Moving, resizing or rotating a group is one command that rewrites the members (the editor's `reframed`).

## Decision Outcome

Option 2, as built. `parentId` records membership and the sibling order; it does not carry a transform. `element.group` and
`element.ungroup` change only `parentId`, the container record and the sibling order, so no member's box moves and no
binding is touched. The hook in `group-bounds.ts` refits the groups a transaction touched, and those around them, deepest
first, in the same transaction and undo step. A group transform in the editor is applied to the members, once per frame,
as one `element.updateMany`; the group box follows by the hook. Entering a group to edit a child (double-click) selects the
child, whose box is already in screen coordinates.

FR-ARR-001 is reworded with this ADR: "Group/ungroup (nested groups); a group's box is the bounds of its members, and
moving, resizing or rotating the group transforms its members; enter a group to edit a child (double-click)."

### Consequences

- Good: grouping is free of side effects; connectors, snapping, hit-testing and exporters read one box per element.
- Good: no composed transforms to get wrong for rotated nested groups.
- Bad: a group transform rewrites every member (one command, so one undo step and one diff entry per member, not one
  for the group).
- Bad: a group has no rotation of its own to keep: rotating a group turns its members about the group's centre, and the
  group's box is then the bounds of the turned members, not a turned box.

### Confirmation

- T0 "FR-ARR-001: group then ungroup restores every child world box within 1e-6" (M8.4) and "editing a member alone refits
  its group and the groups around it, in the same transaction and undo step" (M8.5).
- `e2e/arrange.group-edit.spec.ts` covers group move, resize, rotate and child editing in the browser.
- The completion gate of M8 checks this ADR is accepted and that FR-ARR-001 names the bounds of its members.

## More Information

02-document-model (the element record, `parentId`), 13-layout-and-arrange (FR-ARR-001), ADR-0014 (transactions and undo),
FR-CON-012 (connectors on children of rotated nested groups).
