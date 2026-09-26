# Fluxion Requirements

This folder is the single source of truth for **what** Fluxion must do. *How* is in
[`../architecture`](../architecture) and *how we work* is in [`../standards`](../standards).
Delivery order is in [`../milestones`](../milestones).

## Files

| File | Content |
|---|---|
| [01-scope-and-increments.md](01-scope-and-increments.md) | Vision, scope, release increments R0–R8 and their exit criteria |
| [10-document-and-file.md](10-document-and-file.md) | Document model, screens, file format, persistence, assets |
| [11-shapes-and-library.md](11-shapes-and-library.md) | Shapes, shape definitions, shape library, import |
| [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | Anchors, connectors, routing, labels, riders |
| [13-layout-and-arrange.md](13-layout-and-arrange.md) | Auto layout, grouping, align/distribute, snapping, z-order |
| [14-theme-text-media.md](14-theme-text-media.md) | Themes, palettes, fonts, text, images, media |
| [15-editor.md](15-editor.md) | Edit mode: tools, selection, manipulation, panels, undo, clipboard |
| [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | Present mode, navigation, speaker view, mobile/responsive |
| [17-animation-and-transition.md](17-animation-and-transition.md) | Effects, timelines/builds, transitions, morph, connector flows |
| [18-interaction.md](18-interaction.md) | Triggers, actions, popups, drill-down, state & variables |
| [19-extensibility.md](19-extensibility.md) | Plugin SDK, contribution points, React component elements, packaging, sandbox |
| [20-ai-authoring.md](20-ai-authoring.md) | DSL, JSON schema, validation/repair, CLI, MCP server, generation pipeline |
| [21-import-export-publish.md](21-import-export-publish.md) | Importers, exporters, static info-site publishing |
| [30-non-functional.md](30-non-functional.md) | Performance, size, portability, security, a11y, i18n, reliability, maintainability |
| [40-traceability.md](40-traceability.md) | Requirement → increment → milestone matrix |

## Conventions

**IDs** — `FR-<AREA>-<NNN>` (functional) and `NFR-<AREA>-<NNN>` (non-functional). IDs are
permanent; deprecated requirements are struck through, never renumbered.

**Priority** (MoSCoW):
- **M** — Must: the increment cannot ship without it.
- **S** — Should: expected; may slip one increment with a recorded decision.
- **C** — Could: opportunistic.

**Increment** — `R0`…`R8` (see [01-scope-and-increments.md](01-scope-and-increments.md)). A
requirement is introduced in exactly one increment; later increments may extend it by adding
new IDs, not by editing old acceptance criteria.

**Acceptance criteria** — written so an AI agent can turn each into automated tests
(Given/When/Then or a measurable statement). Every `M` requirement must be covered by at least
one automated test referencing its ID in the test name, e.g.
`it('FR-CON-004: orthogonal route avoids obstacles', …)`.

**Changing requirements** — via a spec change under `specs/` (see
[`../standards/sdd.md`](../standards/sdd.md)); the harness updates this folder and the
traceability matrix in the same PR.

**Acceptance that depends on later features** — some R1 criteria mention capabilities that
arrive later (e.g. build steps in FR-PRS-003, animation preview in FR-EDT-009, speaker view for
FR-SCR-006, plugin bundles in FR-FIL-001, Mermaid paste in FR-EDT-007). In the introducing
increment the criterion is verified for the features that exist; the milestone that adds the
dependent feature extends the test (its plan cites the original ID as "(part)").
