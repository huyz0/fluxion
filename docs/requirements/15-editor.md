# 15 — Editor (Edit Mode)

Area: `EDT`. Principle: **edit mode is present mode plus an overlay**. The same renderer draws
content in both; editing chrome (selection, handles, guides) lives in a separate overlay layer.

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-EDT-001 | M | R1 | Editor layout: top toolbar, left panel (screens navigator / library / layers tabs), center canvas, right inspector, bottom timeline (collapsible). Panels resizable & hideable ("focus mode"). | Layout persists per user. |
| FR-EDT-002 | M | R1 | Canvas: pan (space-drag, middle mouse, trackpad), zoom (ctrl+wheel, pinch, shortcuts, zoom to fit/selection/100 %), rulers optional. | E2E; zoom range 5 %–3200 %. |
| FR-EDT-003 | M | R1 | Tools (state machine): select, hand, shape (current library item), connector, text, frame, pen/path, freehand, image, laser (present). Keyboard shortcuts per tool. | Each tool E2E; `Esc` returns to select. |
| FR-EDT-004 | M | R1 | Selection: click, shift-click, marquee (contain/intersect), select all, select same type/style; selection bounds with resize (8 handles), rotate handle, keep aspect (shift), from center (alt). | E2E + unit geometry tests. |
| FR-EDT-005 | M | R1 | Move: drag, arrow nudge (1 px / 10 px with shift), duplicate by alt-drag, precise values in inspector. | E2E. |
| FR-EDT-006 | M | R1 | **Undo/redo** for every document mutation, with transaction grouping (one drag = one undo step), unlimited depth within session, undo across screens restores view. | Property test: random command sequences undo to initial state. |
| FR-EDT-007 | M | R1 | Clipboard: copy/cut/paste/duplicate within & across documents (and across tabs), paste preserves connections among copied elements, paste images/SVG/text/Mermaid from system clipboard. | E2E. |
| FR-EDT-008 | M | R1 | Inspector: context-sensitive properties for selection (multi-select shows common props, mixed state), token pickers, numeric scrubbing. | Changing a mixed value applies to all selected. |
| FR-EDT-009 | M | R1 | **Mode switch**: Edit ⇄ Present in-place (F5 / button); present preview of current screen (shift+F5); animations preview in edit mode (play selected, play screen, scrub timeline). | Present mode disables all edit interactions (E2E asserts no mutation possible). |
| FR-EDT-010 | M | R1 | **WYSIWYG parity**: content rendered in edit mode is pixel-identical to present mode for the same screen state. | Visual diff edit vs present ≤ 0.1 %. |
| FR-EDT-011 | M | R1 | Command palette (Ctrl/Cmd+K) exposing all commands incl. plugin commands; searchable. | Every registered command appears. |
| FR-EDT-012 | M | R1 | Keyboard shortcut map, customizable, with cheat-sheet overlay (`?`). | Rebinding persists. |
| FR-EDT-013 | S | R1 | Context menus on canvas/element/screen. | E2E. |
| FR-EDT-014 | M | R2 | **AI assistant panel**: prompt to generate/modify doc, screen, or selection (via configured provider adapter or external MCP agent); shows diff preview and applies as one undoable transaction. | Generated change applies & undoes in one step. |
| FR-EDT-015 | S | R3 | Quick-connect: hover a shape shows directional "+" handles; drag creates connector + optional new shape from mini library. | E2E. |
| FR-EDT-016 | S | R3 | Element search (find by text/semantic label) and navigator jumps. | Search highlights matches. |
| FR-EDT-017 | S | R4 | Timeline panel for builds/animations (see `17`): list of steps, drag reorder, triggers, durations, scrub. | E2E. |
| FR-EDT-018 | S | R5 | Interaction editor: visual "wire" from element to target (Figma-prototype-like) + rule list. | E2E. |
| FR-EDT-019 | M | R1 | Touch/tablet editing basics: select, move, resize, pan/zoom with touch; long-press context menu. | E2E on mobile emulation. |
| FR-EDT-020 | S | R8 | Comments/annotations (local, stored in file, not shown in present mode). | Comments round-trip, hidden in present. |
| FR-EDT-021 | M | R1 | Validation panel: live document problems (broken references, missing assets, overlap warnings, contrast warnings) with "fix" actions. | Broken ref shows problem with fix. |
| FR-EDT-022 | S | R2 | Source view: view/edit current screen as DSL text with two-way sync. | Edit DSL → canvas updates; canvas edit → DSL updates. |
| FR-EDT-023 | C | R8 | Version history browser from autosave snapshots with visual diff. | Restore older snapshot. |
