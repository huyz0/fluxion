# 18 — Interaction (Present-mode behavior)

Area: `INT`. Interactions are declarative **rules**: `trigger → [condition] → actions[]`, attached
to elements, screens, or the document. They run only in present mode (and in edit-mode preview).

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-INT-001 | M | R5 | Triggers: click/tap, double-click, hover enter/leave (with touch fallback), long-press, key press, screen enter/exit, build step reached, timer, variable change, rider arrive, component-emitted custom event. | Unit test per trigger with simulated events. |
| FR-INT-002 | M | R5 | Actions: navigate (next/prev/screen/step/URL), open popup/overlay, close overlay, show/hide/toggle element(s), play/pause/restart animation or named timeline, set screen state, set/increment/toggle variable, zoom to element/sub-screen, back (history), start/stop riders, emit event, call component method. | Unit test per action. |
| FR-INT-003 | M | R5 | **Popups/overlays**: content is an element group or a screen; positions: anchored to element (tooltip/popover with arrow), centered modal, side drawer, full-screen; backdrop, dismiss by click-outside/Esc; transitions. | E2E; focus trapped in modal and restored on close. |
| FR-INT-004 | M | R5 | Conditions on variables/state (safe expression language, see FR-DOC-009). | Conditional branch fires correctly. |
| FR-INT-005 | M | R5 | Hotspots: invisible/visible clickable regions; hover affordances (cursor, highlight) configurable; visible focus rings for keyboard. | Keyboard Tab reaches hotspots in order. |
| FR-INT-006 | M | R5 | **Branching navigation**: non-linear paths with a navigation history stack; "back" returns to origin screen & step. | E2E branching fixture. |
| FR-INT-007 | S | R5 | Drill-down: click a shape to zoom into its sub-screen (FR-SCR-008) with breadcrumb and zoom-out. | E2E. |
| FR-INT-008 | S | R5 | Interactive "explore" mode for diagrams: pan/zoom within a screen in present mode, focus element (dim others) and show details panel from semantic data. | E2E. |
| FR-INT-009 | S | R5 | Quizzes/polls lightweight components (local only) as pack components. | Component emits answer event. |
| FR-INT-010 | M | R5 | All interactions are keyboard- and screen-reader-accessible (see NFR-A11Y). | axe checks pass; keyboard E2E. |
| FR-INT-011 | S | R5 | Interaction debugger in edit mode: shows rule firing log, variable values. | Log displays fired rules. |
