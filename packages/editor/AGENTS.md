# @fluxion/editor — agent notes

Edit overlay, tools state machine, panels, inspector, library, timeline and interaction editors, AI panel.
Design: ADR-0028 (interaction architecture) and ADR-0029 (the chrome); 04 §3.

## Rules

- Layer L4: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- DOM allowed. Business logic belongs in the pure packages below this layer.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag.
- The document is written only through commands (`execute`). A gesture writes once per frame through `beginGesture` under one merge key, so a drag is one undo step.

## Map (M6)

- **session** (`session.ts`): per-document signals: selection, camera, tool, hover, marquee, draft, sketch, laser, pending image pick, mode (edit or present). Never part of the document.
- **camera** (`camera.ts`, pure): page ⇄ canvas mapping, zoom clamping and fit; `canvas-input.ts` maps wheel and keys to cameras.
- **pointer pipeline** (`pointer.ts`, `pointer-input.ts`): one listener per event type, moves coalesced once per animation frame. `touch.ts` and `touch-input.ts` handle fingers: pinch, pan and long press.
- **tools** (`tools.ts`): hand-rolled statecharts in a registry; the dispatcher picks the current tool by `session.tool` and its mode (edit or present). Tools: `select-tool.ts`, `builtin-tools.ts` (hand), `create-tool.ts` (shape, text, frame, image), `connector-tool.ts`, `path-tool.ts` (pen, freehand), `laser-tool.ts` (present only).
- **hit-testing** (`hit-test.ts`, `connector-hit.ts`, `stroke-band.ts`, `outline-distance.ts`): an rbush index kept from store diffs, and exact geometry tests (stroke band, miter spikes, labels, markers); `box-touch.ts` for the marquee.
- **overlay** (`overlay.tsx`, `overlay-geometry.ts`): one SVG in canvas px, mounted only when there is something to draw (selection frame, handles, hover, marquee, draft, sketch).
- **chrome** (`editor-root.tsx`, `panels.tsx`, `canvas.tsx`, `splitter.tsx`, `layout.ts`, `chrome-css.ts`): toolbar, panels, canvas; `present.tsx` presents in place (F5) with every write refused.

## Tests

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs.
- T0 for logic (pure modules are `.ts`, mutation-tested), T1 (browser) for components.
- E2E specs in `e2e/`: `canvas.pan-zoom`, `tools.*`, `selection.marquee`, `move.*`, `transform.*`, `touch.edit-basics` (@mobile), `present.mode-switch`, `parity.edit-vs-present`, `perf.drag-500` (@perf, `pnpm test:perf`), `a11y.editor-shell`.
