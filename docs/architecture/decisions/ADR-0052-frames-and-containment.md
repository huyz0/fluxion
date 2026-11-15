---
status: accepted
date: 2026-11-14
decision-makers: harness (M19.6; within FR-ARR-006, FR-EDT-004 and FR-LAY-010; no requirement changes)
ratifies: M6.31's frame defaults (clip on, radius-rounded clip, theme `defaults.frame`)
---

# ADR-0052 — Frames carry their members in screen coordinates, clip what they draw and what can be hit, and adopt what is dropped in them

## Context and Problem Statement

FR-ARR-006 asks for frames and containers (a swimlane, a card, a section) that clip and contain their children, the children
moving with the container. The `frame` element exists since schema 1.0 (`transform`, `text?`, `clip?`, `padding?`, `layout?`) and
M6.31 drew it: its box in its resolved style over the theme's `defaults.frame`, its members clipped to the box, the corner radius
rounding the clip, unless `clip: false`. What was never decided (M6 cp2 F4):

- how a member's position relates to its frame's (local or screen coordinates) and what a frame's move, resize, turn and flip
  do to its members;
- how an element becomes a member (drop to reparent) and stops being one;
- how frames meet groups (FR-ARR-001) and live layouts (FR-LAY-010, ADR-0046);
- whether a clipped-away part of a member can be hit or marquee-selected (today it can: hit-testing ignores the clip).

## Decision Drivers

- One containment model for frames, groups and layouts, so reparent and undo do not tangle (M19 risk table).
- One user action is one undo step (ADR-0014), including a reparent and any re-layout it triggers (ADR-0046).
- What is not drawn is not hit: selection must match pixels (FR-EDT-004, FR-EDT-010 edit/present parity).
- No file-format change if the existing fields suffice (contracts.md rule 6); a 1.7 file means the same in 1.8.

## Considered Options

1. **Members in frame-local coordinates.** A frame's move is one field change and turns and flips compose naturally. But every
   reader of a transform (geometry, routing, export, hit-testing, the DSL decompiler, connectors bound across frames) would need
   the ancestor chain, and moving an element in or out of a frame would rewrite its numbers. A format change (rule 6).
2. **Members in screen coordinates; the frame's commands carry them (chosen).** The model groups already use (02 §3: members keep
   screen coordinates; `withMembers` moves them along, ADR-0014 one step). Every reader keeps reading one transform; a reparent
   changes only `parentId` and `index`.
3. **Frames as a render-only grouping (no membership).** Clipping by geometry, no `parentId`. Simple, but a frame's move could not
   carry its members and the layers panel (FR-ARR-008) would show no tree.

## Decision Outcome

Option 2.

### Coordinates and transforms

- A member's `transform` is in screen coordinates, as for groups. A frame's own box is its own: unlike a group's it is never
  refitted to its members, and the group-bounds hook stops at a frame (a group above a frame refits to the frame's box, not to the
  frame's members).
- **Move**: a frame's move moves every member, all the way down, by the same delta in the same transaction (`withMembers`, as for
  a group). Keyboard nudge, align and distribute move a frame the same way.
- **Resize**: a frame's resize changes its box only. Members stay where they are; what falls outside is clipped (a container
  reveals or hides, it does not scale). **This reverses shipped behaviour**: today the select tool's resize handle
  (`packages/editor/src/select-tool.ts`, `starts()` then `reframed()` in `move.ts`) carries every member of a selected frame and
  scales it. M19.10 changes that path so a frame's resize writes the frame alone; a group's resize keeps scaling its members, and
  a selection holding a frame and other elements scales the others and resizes the frame's box only.
- **Turn and flip**: turning a frame by θ turns its members about the frame's centre in the same transaction (each member's centre
  rotated by θ, its own `rot` increased by θ). Flipping a frame horizontally mirrors each member's centre across the frame's
  vertical centre line, toggles its `flipX` and maps its `rot` to `(360 − rot) % 360` (a mirror reverses a turn); vertically, the
  same across the horizontal centre line with `flipY`. So the frame and its content stay one picture. The clip follows the
  frame's turned box.

### Membership: drop to reparent

- When a drag of selected elements ends, each dragged element whose new **centre** lies inside a frame's box (the deepest,
  topmost frame on the same screen under that point that is neither the element nor one of its descendants) becomes that
  frame's member; one whose centre lies outside its current frame leaves it for the frame's own container (the next frame up, or
  the screen). The reparent sets `parentId` and an `index` above the new siblings, in the drag's transaction (one undo step).
- Only a pointer drag reparents. Keyboard nudge, align, distribute and layout never change membership; neither does a drag that
  starts and ends inside the same frame.
- A member of a group dragged alone stays in its group (group membership changes only through group and ungroup); dragging the
  whole group into a frame reparents the group.
- Connectors are not reparented by a drop; a connector's container stays where it is, its ends follow their shapes.

### Live layouts

- A frame's `padding` is the inset its layout keeps from the frame's edges; the clip stays at the box's edge and the view draws
  nothing for it. Today nothing reads the frame's `padding`: a layout scoped to a container uses the bare box
  (`packages/layout/src/snapshot.ts`) and each algorithm applies its own `padding` option (default 80: stack, grid, layered, tree).
  From M19.10 the inset is `layout.options.padding ?? frame.padding ?? <the algorithm's default>`: an explicit layout option wins,
  then the frame's field, then today's default, so frames without `padding` lay out exactly as before. The inset is applied once
  (never added to the algorithm's own).
- An element dropped into a frame whose layout is `live` gets `placement: 'auto'`, so the layout adopts it in the amending
  transaction (ADR-0046); dropped anywhere else it is pinned as today (ADR-0031). Leaving a live frame does not re-run the layout
  of the frame it joins unless that one is live too.

### Clip, hit-testing and the marquee

- The M6.31 defaults are ratified, unchanged, so no migration: a frame clips unless `clip: false`; the clip is the box rounded by
  the resolved corner radius; the theme's `defaults.frame` styles the box.
- A point hits a member only if it lies inside every clipping frame above it (the rounded box, turned with its frame). A member
  wholly clipped away cannot be hit.
- The marquee judges a member by its visible part: its bounds intersected with each clipping ancestor's box. A member with no
  visible part is never marquee-selected; containment and touch modes (FR-EDT-004) read the visible part.
- Present mode needs nothing new: it draws through the same views (ADR-0015).

## Consequences

- Good: no format change; one reading of a transform everywhere; reparent and undo are one transaction; groups keep their model.
- Good: what can be hit matches what is drawn, in edit and present.
- Bad: a frame's move, turn and flip write every member (O(members) per move, as groups already do); bounded by the 60 Hz drag
  coalescing ADR-0046 relies on.
- Bad: centre-based reparenting can surprise for an element larger than the frame; the drop highlight (M19.10) shows the target
  before release.

## Confirmation

- `packages/core/src/commands/frames.test.ts` (M19.10): move carries members by the same delta; resize leaves them; turn and
  flip carry them (a member turned 30° in a horizontally flipped frame ends at 330° with `flipX` toggled); a frame's `padding`
  feeds its layout's inset unless the layout names its own; drop-to-reparent and leaving a frame, each one undo step; a property test over random reparent + undo sequences
  restores the store exactly. An editor test of the select tool's resize handle (M19.10) shows a selected frame resized with a
  member at its edge leaves the member's transform unchanged, and a group resized the same way still scales its member.
- `packages/editor/src/frame-hit.test.ts` and `packages/render/src/frame-clip.browser.test.tsx` (M19.11): an overflowing child
  is hidden outside a clipping frame and neither hit nor marquee-selected there; `clip: false` restores both.
- m19-complete legs 'FR-ARR-006 …' and the parity leg with the masters-tables example's clipping frame (M19.26).

## Links

- ADR-0014 (transactions, one undo step), ADR-0015 (one render path), ADR-0031 (placement), ADR-0046 (live layout reactor).
- 02-document-model §3 (groups keep screen coordinates); FR-ARR-006, FR-ARR-001, FR-EDT-004, FR-LAY-010.
