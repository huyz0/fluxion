---
status: accepted
date: 2026-09-30
decision-makers: Fluxion maintainers (M6.2, delegated to the driver)
supersedes: ADR-0002 (its sentence "Editor UI state stays in Zustand")
---

# ADR-0028 — Editor interaction architecture: statechart tools, a signal session store, a screen-space SVG overlay, a frame-batched pointer pipeline

## Context and Problem Statement

M6 builds the editor's interaction layer (FR-EDT-002 to FR-EDT-005, FR-EDT-019): the camera,
selection, tools, handles and gestures over the `<ScreenView>` that present mode also draws
(FR-EDT-010). Dragging one element among 500 must stay at 55 fps or more (NFR-PERF-001), and a
gesture must be one undo step (ADR-0014 merge keys). 04 §3 sketches the design, and M6.md names
four choices to settle before coding:
1. how tools are modelled;
2. where session state (selection, camera, tool, hover) lives;
3. how the overlay (bounds, handles, marquee) is drawn;
4. how pointer input reaches the store.

## Decision Drivers

- NFR-PERF-001: at most one store diff and one React commit per frame during a drag (04 §5).
- FR-EDT-004 and FR-EDT-005: selection, 8 resize handles and a rotate handle, drag, nudge and
  duplicate. One gesture is one undo step (ADR-0014 merge keys), and handles keep their size at any
  zoom (04 §3.3, M6 plan row 10).
- FR-EDT-003: tools are a state machine with per-tool shortcuts, and Esc returns to `select`; a
  `tools` registry (03 §4, plugins add tools) is this design's way to hold them.
- Session state is never part of the document, is per document, and must not re-render
  everything when one field changes.
- No new runtime dependency without a reason (non-negotiable 8); the editor is not in the player
  bundle, but it counts toward `EDITOR_INITIAL_GZIP`.
- The pure-core rule: interaction logic that can be pure (camera math, hit-testing, resize and
  rotate geometry, tool transitions) is unit-tested without a DOM.

## Considered Options

- **Tools:** (A1) hand-rolled statecharts (`StateNode`, 04 §3.2); (A2) XState machines.
- **Session store:** (B1) core's signals (`writable`/`computed`, alien-signals, ADR-0002) in a
  per-document session object; (B2) a Zustand store per document, as 04 §3.1 sketched.
- **Overlay:** (C1) one SVG in screen coordinates above `<ScreenView>`; (C2) a Canvas2D layer;
  (C3) handles drawn inside the scaled content SVG.
- **Pointer input:** (D1) one listener per event type on the viewport, events coalesced
  (`getCoalescedEvents`), applied once per animation frame in one transaction with the gesture's
  `mergeKey`, the history sealed at pointer-up; (D2) a transaction per pointer event.

## Decision Outcome

Chosen: **A1, B1, C1, D1**.

1. **Tools are hand-rolled statecharts.** A tool is a tree of `StateNode`s with `onEnter`,
   `onExit`, pointer, key and `onCancel` handlers that return a `Transition` (04 §3.2). Tools are
   registered in a `tools` registry with their shortcuts. The dispatcher sends every input to the
   current node. Esc and `pointercancel` call `onCancel`, and a tool's root state on Esc returns
   to `select`. Transitions are plain data, so a tool is tested by feeding it `PointerInfo`
   streams with no DOM.
2. **The session store is core signals.** `createSession(docId)` returns an object of writable
   signals: `selection: RecordId[]`, `camera: {x, y, z}`, `tool: string`, `hover`, and later the
   snap guides. One session is kept per document id and dropped with it. Components read them
   through render's `useValue`, so a hover change re-renders the overlay only. Core exports
   `writable` and `WritableSignal` for this (M6.6). The session is
   never passed to `store.transact` or serialized; `metaBefore`/`metaAfter` carry the selection
   into history (ADR-0014) for selection-restoring undo. This replaces 04 §3.1's Zustand, which
   would add a dependency and a second reactivity model beside the store's.
3. **The overlay is one SVG in screen coordinates** above the content layer. Handles are not
   scaled by the camera, so they keep their size (8 px). The overlay reads the selection's
   element transforms through the camera. The Canvas2D fallback (behind the same component API)
   is taken only if the `perf.drag-500` trace shows the overlay's own work above 2 ms per frame,
   or a selection needs more than 2000 handles.
4. **Pointer input is frame-batched.** One listener per type on the canvas viewport builds a
   `PointerInfo` (screen point, page point = camera⁻¹(screen), buttons, modifiers, pressure). Moves
   are coalesced and applied once per `requestAnimationFrame`. A gesture's writes go through
   `store.transact` with `mergeKey: 'gesture:<n>'`, so the drag is one undo entry. The history is
   sealed at pointer-up. During a translate only transforms change, so memoized element views
   re-render their wrappers only (04 §5, transform-only drags).

### Consequences

- Good, because there is no new runtime dependency and one reactivity model across the store,
  the session and the views.
- Good, because tools, camera math, hit-testing and transform geometry are pure and tested in
  T0, while the DOM glue stays thin.
- Good, because a gesture is one undo entry through the existing merge keys, with no editor-side
  history.
- Bad, because statecharts are hand-written: there is no visualizer, and complex modal flows
  (AI sessions, M28) must keep to plain reducers, as 04 §3.2 already says.
- Bad, because an SVG overlay with many handles costs DOM nodes; the fallback criteria above say
  when to move it.

### Confirmation

The m6-complete legs:
- the T0 tests "FR-EDT-003: a drag stream commits at most one store diff per frame" and
  "FR-EDT-003: Esc returns any tool to select";
- the T1 tests "FR-EDT-004: handles stay 8 px at 25 % and 400 % zoom" and "FR-EDT-005: dragging
  one element re-renders only that element and the overlay";
- the `perf.drag-500` spec at `EDITOR_DRAG_MIN_FPS` or more;
- the E2E resize and rotate undo spec.
`check-licenses` shows no new dependency.

## Pros and Cons of the Options

- **A2 XState**: visual tooling and a well-known model, but a dependency and an actor runtime on
  the hottest path; transitions are harder to type against our `PointerInfo`.
- **B2 Zustand**: familiar and small, but a second subscription model next to signals; selectors
  must be memoized by hand to avoid re-rendering on unrelated fields.
- **C2 Canvas2D**: cheap for thousands of handles, but no accessible or hit-testable DOM for
  handles, and text labels need their own layout; kept as the fallback.
- **C3 handles inside the content SVG**: their size scales with zoom, and the content DOM would
  differ between edit and present, breaking parity (FR-EDT-010).
- **D2 a transaction per event**: simple, but several store diffs and React commits per frame
  under high-rate pointers, against NFR-PERF-001.

## More Information

04 §3.1-3.3 and §5 (updated in this commit: the session store is signals), ADR-0002 (signals),
ADR-0014 (transactions, merge keys, `metaBefore`/`metaAfter`), ADR-0141 (the spatial index used for
hit-testing).
