# 40 — Traceability Matrix

> Read when: planning a milestone, checking coverage, or changing a requirement.
> Generated from requirement tables + `docs/milestones/roadmap.md` scope column; regenerate with
> `node scripts/gates/check-trace.mjs --write` (from M1). The **Tests** column is filled by
> `check-trace` from test titles containing the ID.

## Summary by increment

| Inc | Must | Should | Could | Total |
|---|---|---|---|---|
| R0 | 30 | 0 | 0 | 30 |
| R1 | 84 | 7 | 0 | 91 |
| R2 | 31 | 13 | 0 | 44 |
| R3 | 17 | 33 | 0 | 50 |
| R4 | 25 | 16 | 0 | 41 |
| R5 | 9 | 13 | 0 | 22 |
| R6 | 19 | 8 | 4 | 31 |
| R7 | 7 | 11 | 1 | 19 |
| R8 | 2 | 5 | 3 | 10 |

All 338 requirements are assigned to at least one milestone. A requirement listed under
two milestones is delivered in parts (see the milestone plans for the split).

## Matrix

| ID | Pri | Inc | Milestone(s) | Source | Tests |
|---|---|---|---|---|---|
| FR-DOC-001 | M | R0 | M2 | [10-document-and-file.md](10-document-and-file.md) | `packages/schema/src/document-file.test.ts` +8 |
| FR-DOC-002 | M | R0 | M2 | [10-document-and-file.md](10-document-and-file.md) | `packages/schema/src/ids.test.ts` |
| FR-DOC-003 | M | R0 | M2 | [10-document-and-file.md](10-document-and-file.md) | `packages/schema/src/migrate.test.ts`, `packages/schema/src/repair.test.ts` |
| FR-DOC-004 | M | R0 | M2 | [10-document-and-file.md](10-document-and-file.md) | `packages/schema/src/document-file.test.ts` +5 |
| FR-DOC-005 | M | R0 | M2 | [10-document-and-file.md](10-document-and-file.md) | `packages/render/src/elements.browser.test.tsx` +12 |
| FR-DOC-006 | M | R1 | M9 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-DOC-007 | S | R2 | M13 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-DOC-008 | S | R5 | M24 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-DOC-009 | C | R6 | M28 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-DOC-010 | M | R0 | M2 | [10-document-and-file.md](10-document-and-file.md) | `packages/core/src/builtin-commands.test.ts` +3 |
| FR-SCR-001 | M | R0 | M2, M4 | [10-document-and-file.md](10-document-and-file.md) | `e2e/render.static-html.spec.ts` +9 |
| FR-SCR-002 | M | R1 | M8 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-SCR-003 | M | R1 | M8 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-SCR-004 | S | R1 | M8 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-SCR-005 | S | R3 | M19 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-SCR-006 | M | R1 | M8 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-SCR-007 | S | R5 | M25 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-SCR-008 | S | R5 | M25 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-001 | M | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-002 | M | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-003 | M | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-004 | M | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-005 | S | R2 | M12 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-006 | M | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-007 | M | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-008 | S | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-009 | M | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-010 | S | R6 | M27 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-FIL-011 | C | R8 | M32 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-AST-001 | M | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-AST-002 | S | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-AST-003 | S | R3 | M18 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-AST-004 | S | R4 | M23 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-AST-005 | M | R1 | M10 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-AST-006 | S | R2 | M15 | [10-document-and-file.md](10-document-and-file.md) | — |
| FR-SHP-001 | M | R0 | M2 | [11-shapes-and-library.md](11-shapes-and-library.md) | `packages/geometry/src/box.test.ts` +6 |
| FR-SHP-002 | M | R1 | M5 | [11-shapes-and-library.md](11-shapes-and-library.md) | `e2e/render.shapes-gallery.spec.ts` +3 |
| FR-SHP-003 | M | R1 | M5, M7 | [11-shapes-and-library.md](11-shapes-and-library.md) | `packages/core/src/expr/expr.test.ts` +7 |
| FR-SHP-004 | M | R1 | M5 | [11-shapes-and-library.md](11-shapes-and-library.md) | `packages/geometry/src/round.test.ts` +7 |
| FR-SHP-005 | M | R1 | M5 | [11-shapes-and-library.md](11-shapes-and-library.md) | `packages/core/src/shape/hit.test.ts`, `packs/basic/src/hit.test.ts` |
| FR-SHP-006 | M | R1 | M5 | [11-shapes-and-library.md](11-shapes-and-library.md) | `packages/core/src/shape/shape-text.test.ts` +3 |
| FR-SHP-007 | S | R3 | M19 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-SHP-008 | M | R3 | M19 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-SHP-009 | S | R3 | M19 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-SHP-010 | S | R3 | M19 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-SHP-011 | S | R3 | M19 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-SHP-012 | M | R1 | M5 | [11-shapes-and-library.md](11-shapes-and-library.md) | `packages/render/src/image-view.browser.test.tsx` |
| FR-SHP-013 | M | R6 | M27 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-SHP-014 | S | R3 | M19 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-SHP-015 | S | R6 | M28 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-SHP-016 | C | R6 | M28 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-001 | M | R1 | M8 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-002 | M | R1 | M8 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-003 | M | R3 | M18 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-004 | M | R3 | M18 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-005 | S | R3 | M18 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-006 | S | R3 | M18 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-007 | M | R3 | M18 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-008 | S | R3 | M18 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-009 | M | R3 | M18 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-010 | S | R6 | M26 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-LIB-011 | S | R3 | M18 | [11-shapes-and-library.md](11-shapes-and-library.md) | — |
| FR-ANC-001 | M | R1 | M5 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | `packages/routing/src/anchor.test.ts`, `packages/routing/src/connector-route.test.ts` |
| FR-ANC-002 | M | R1 | M5 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | `packages/routing/src/anchor.test.ts`, `packages/routing/src/connector-route.test.ts` |
| FR-ANC-003 | M | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-ANC-004 | M | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-ANC-005 | S | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-ANC-006 | M | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-ANC-007 | S | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-ANC-008 | S | R6 | M27 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-CON-001 | M | R0 | M2 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | `packages/geometry/src/intersections.test.ts` +7 |
| FR-CON-002 | M | R1 | M5 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | `packages/routing/src/curved.test.ts`, `packages/routing/src/orthogonal.test.ts` |
| FR-CON-003 | M | R1 | M5 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | `packages/cli/src/e2e/cli.markers.test.ts` +6 |
| FR-CON-004 | M | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-CON-005 | M | R1 | M5 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | `packages/geometry/src/round.test.ts`, `packages/render/src/connector-view.test.tsx` |
| FR-CON-006 | M | R1 | M5 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | `packages/render/src/connector-view.browser.test.tsx` +3 |
| FR-CON-007 | M | R1 | M7 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-CON-008 | S | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-CON-009 | S | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-CON-010 | S | R3 | M18 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-CON-011 | S | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-CON-012 | M | R1 | M5 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | `packages/routing/src/attachment.test.ts` |
| FR-CON-013 | S | R4 | M23 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-RTE-001 | M | R1 | M5 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | `packages/render/src/connector-view.browser.test.tsx` +2 |
| FR-RTE-002 | M | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-RTE-003 | S | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-RTE-004 | M | R3 | M16 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-RDR-001 | M | R4 | M23 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-RDR-002 | M | R4 | M23 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-RDR-003 | S | R4 | M23 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-RDR-004 | S | R4 | M23 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-RDR-005 | M | R4 | M23 | [12-connectors-anchors-routing.md](12-connectors-anchors-routing.md) | — |
| FR-LAY-001 | M | R2 | M13 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-002 | M | R2 | M13 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-003 | M | R3 | M17 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-004 | M | R2 | M13 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-005 | M | R2 | M13 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-006 | M | R3 | M17 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-007 | M | R2 | M13 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-008 | M | R2 | M13 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-009 | M | R4 | M22 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-010 | S | R3 | M17 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-011 | S | R3 | M17 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-012 | S | R3 | M17 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-013 | S | R7 | M29 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-LAY-014 | S | R3 | M17 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-ARR-001 | M | R1 | M8 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-ARR-002 | M | R1 | M8 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-ARR-003 | M | R1 | M8 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-ARR-004 | M | R1 | M8 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-ARR-005 | M | R1 | M8 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-ARR-006 | S | R3 | M19 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-ARR-007 | S | R3 | M19 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-ARR-008 | S | R3 | M19 | [13-layout-and-arrange.md](13-layout-and-arrange.md) | — |
| FR-THM-001 | M | R1 | M4, M9 | [14-theme-text-media.md](14-theme-text-media.md) | `packages/render/src/ssr.test.ts` +2 |
| FR-THM-002 | M | R1 | M9 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-THM-003 | M | R1 | M9 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-THM-004 | M | R1 | M9 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-THM-005 | S | R3 | M20 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-THM-006 | M | R3 | M20 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-THM-007 | S | R3 | M20 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-THM-008 | M | R1 | M9 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-THM-009 | S | R3 | M20 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-THM-010 | S | R7 | M29 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-THM-011 | C | R6 | M28 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-TXT-001 | M | R1 | M7 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-TXT-002 | M | R1 | M7 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-TXT-003 | M | R1 | M7 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-TXT-004 | S | R1 | M7 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-TXT-005 | S | R4 | M23 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-TXT-006 | M | R8 | M32 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-TXT-007 | S | R4 | M23 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-TXT-008 | C | R6 | M28 | [14-theme-text-media.md](14-theme-text-media.md) | — |
| FR-EDT-001 | M | R1 | M6 | [15-editor.md](15-editor.md) | `apps/studio/src/bootstrap.browser.test.ts` +14 |
| FR-EDT-002 | M | R1 | M6 | [15-editor.md](15-editor.md) | `e2e/canvas.pan-zoom.spec.ts` +7 |
| FR-EDT-003 | M | R1 | M6 | [15-editor.md](15-editor.md) | `e2e/tools.connector.spec.ts` +19 |
| FR-EDT-004 | M | R1 | M6 | [15-editor.md](15-editor.md) | `e2e/selection.marquee.spec.ts` +19 |
| FR-EDT-005 | M | R1 | M6 | [15-editor.md](15-editor.md) | `e2e/move.nudge-and-duplicate.spec.ts` +4 |
| FR-EDT-006 | M | R1 | M3, M7 | [15-editor.md](15-editor.md) | `packages/core/src/commands.test.ts` +3 |
| FR-EDT-007 | M | R1 | M7 | [15-editor.md](15-editor.md) | — |
| FR-EDT-008 | M | R1 | M7 | [15-editor.md](15-editor.md) | — |
| FR-EDT-009 | M | R1 | M6 | [15-editor.md](15-editor.md) | — |
| FR-EDT-010 | M | R1 | M6 | [15-editor.md](15-editor.md) | `packages/editor/src/chrome-css.test.ts` +2 |
| FR-EDT-011 | M | R1 | M7 | [15-editor.md](15-editor.md) | — |
| FR-EDT-012 | M | R1 | M7 | [15-editor.md](15-editor.md) | — |
| FR-EDT-013 | S | R1 | M7 | [15-editor.md](15-editor.md) | — |
| FR-EDT-014 | M | R2 | M15 | [15-editor.md](15-editor.md) | — |
| FR-EDT-015 | S | R3 | M19 | [15-editor.md](15-editor.md) | — |
| FR-EDT-016 | S | R3 | M19 | [15-editor.md](15-editor.md) | — |
| FR-EDT-017 | S | R4 | M22 | [15-editor.md](15-editor.md) | — |
| FR-EDT-018 | S | R5 | M25 | [15-editor.md](15-editor.md) | — |
| FR-EDT-019 | M | R1 | M6 | [15-editor.md](15-editor.md) | — |
| FR-EDT-020 | S | R8 | M32 | [15-editor.md](15-editor.md) | — |
| FR-EDT-021 | M | R1 | M7 | [15-editor.md](15-editor.md) | — |
| FR-EDT-022 | S | R2 | M12 | [15-editor.md](15-editor.md) | — |
| FR-EDT-023 | C | R8 | M32 | [15-editor.md](15-editor.md) | — |
| FR-PRS-001 | M | R1 | M11 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-PRS-002 | M | R1 | M11 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-PRS-003 | M | R1 | M11 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-PRS-004 | M | R1 | M11 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-PRS-005 | M | R1 | M11 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-PRS-006 | S | R1 | M11 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-PRS-007 | S | R4 | M22 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-PRS-008 | S | R5 | M25 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-PRS-009 | M | R1 | M11 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-SPK-001 | M | R5 | M25 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-SPK-002 | S | R5 | M25 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-SPK-003 | S | R5 | M25 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-RSP-001 | M | R1 | M11 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-RSP-002 | M | R7 | M29 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-RSP-003 | M | R7 | M29 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-RSP-004 | S | R7 | M29 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-RSP-005 | M | R7 | M29 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-RSP-006 | S | R7 | M29 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-RSP-007 | M | R1 | M11 | [16-player-presentation-responsive.md](16-player-presentation-responsive.md) | — |
| FR-ANI-001 | M | R4 | M21 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-ANI-002 | M | R4 | M21 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-ANI-003 | M | R4 | M21 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-ANI-004 | M | R4 | M21 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-ANI-005 | M | R4 | M21 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-ANI-006 | M | R4 | M21 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-ANI-007 | M | R4 | M21 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-ANI-008 | M | R4 | M21 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-ANI-009 | S | R4 | M23 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-ANI-010 | S | R4 | M23 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-ANI-011 | M | R4 | M21 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-TML-001 | M | R4 | M22 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-TML-002 | M | R4 | M22 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-TML-003 | S | R4 | M22 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-TML-004 | S | R4 | M22 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-TML-005 | M | R4 | M22 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-TRN-001 | M | R4 | M22 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-TRN-002 | M | R4 | M22 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-TRN-003 | S | R5 | M25 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-TRN-004 | S | R4 | M22 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-MRP-001 | M | R4 | M22 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-MRP-002 | S | R4 | M22 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-FLW-001 | M | R4 | M23 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-FLW-002 | M | R4 | M23 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-FLW-003 | S | R4 | M23 | [17-animation-and-transition.md](17-animation-and-transition.md) | — |
| FR-INT-001 | M | R5 | M24 | [18-interaction.md](18-interaction.md) | — |
| FR-INT-002 | M | R5 | M24 | [18-interaction.md](18-interaction.md) | — |
| FR-INT-003 | M | R5 | M24 | [18-interaction.md](18-interaction.md) | — |
| FR-INT-004 | M | R5 | M24 | [18-interaction.md](18-interaction.md) | — |
| FR-INT-005 | M | R5 | M24 | [18-interaction.md](18-interaction.md) | — |
| FR-INT-006 | M | R5 | M24 | [18-interaction.md](18-interaction.md) | — |
| FR-INT-007 | S | R5 | M25 | [18-interaction.md](18-interaction.md) | — |
| FR-INT-008 | S | R5 | M25 | [18-interaction.md](18-interaction.md) | — |
| FR-INT-009 | S | R5 | M25 | [18-interaction.md](18-interaction.md) | — |
| FR-INT-010 | M | R5 | M24 | [18-interaction.md](18-interaction.md) | — |
| FR-INT-011 | S | R5 | M25 | [18-interaction.md](18-interaction.md) | — |
| FR-EXT-001 | M | R0 | M3 | [19-extensibility.md](19-extensibility.md) | `packages/cli/src/host.test.ts` +15 |
| FR-EXT-002 | M | R6 | M26 | [19-extensibility.md](19-extensibility.md) | — |
| FR-EXT-003 | M | R6 | M26 | [19-extensibility.md](19-extensibility.md) | — |
| FR-EXT-004 | M | R6 | M26 | [19-extensibility.md](19-extensibility.md) | — |
| FR-EXT-005 | M | R6 | M26 | [19-extensibility.md](19-extensibility.md) | — |
| FR-EXT-006 | M | R6 | M26 | [19-extensibility.md](19-extensibility.md) | — |
| FR-EXT-007 | S | R6 | M26 | [19-extensibility.md](19-extensibility.md) | — |
| FR-EXT-008 | M | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-CMP-001 | M | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-CMP-002 | M | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-CMP-003 | M | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-CMP-004 | M | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-CMP-005 | M | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-CMP-006 | S | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-CMP-007 | M | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-PKG-001 | M | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-PKG-002 | M | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-PKG-003 | M | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-PKG-004 | S | R6 | M27 | [19-extensibility.md](19-extensibility.md) | — |
| FR-PKG-005 | S | R8 | M33 | [19-extensibility.md](19-extensibility.md) | — |
| FR-DSL-001 | M | R2 | M12 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-DSL-002 | M | R2 | M12 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-DSL-003 | M | R4 | M22 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-DSL-004 | M | R5 | M24 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-DSL-005 | M | R2 | M12 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-DSL-006 | M | R2 | M12 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-DSL-007 | S | R2 | M15 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-DSL-008 | S | R3 | M20 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-DSL-009 | S | R2 | M12 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-001 | M | R2 | M14 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-002 | M | R2 | M14 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-003 | M | R2 | M14 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-004 | M | R2 | M14 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-005 | M | R2 | M14 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-006 | S | R2 | M14 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-007 | S | R2 | M15 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-008 | S | R4 | M23 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-009 | M | R2 | M15 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-010 | S | R2 | M12 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-AI-011 | M | R2 | M14 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-CLI-001 | M | R0 | M4 | [20-ai-authoring.md](20-ai-authoring.md) | `packages/cli/src/e2e/cli.render.test.ts` +5 |
| FR-CLI-002 | M | R2 | M14 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-CLI-003 | M | R6 | M26 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-CLI-004 | S | R7 | M31 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-CLI-005 | M | R2 | M14 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-MCP-001 | M | R2 | M15 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-MCP-002 | M | R2 | M15 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-MCP-003 | S | R5 | M25 | [20-ai-authoring.md](20-ai-authoring.md) | — |
| FR-IMP-001 | M | R2 | M15 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-IMP-002 | M | R2 | M15 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-IMP-003 | S | R7 | M31 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-IMP-004 | S | R7 | M31 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-IMP-005 | C | R7 | M31 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-EXP-001 | M | R1 | M10 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-EXP-002 | M | R7 | M30 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-EXP-003 | M | R7 | M30 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-EXP-004 | M | R3 | M20 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-EXP-005 | S | R7 | M30 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-EXP-006 | S | R7 | M30 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-EXP-007 | S | R2 | M14 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-EXP-008 | M | R2 | M14 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-SITE-001 | M | R7 | M31 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-SITE-002 | M | R7 | M31 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-SITE-003 | S | R7 | M31 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-SITE-004 | S | R7 | M31 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| FR-SITE-005 | C | R8 | M33 | [21-import-export-publish.md](21-import-export-publish.md) | — |
| NFR-PERF-001 | M | R1 | M6 | [30-non-functional.md](30-non-functional.md) | `packages/render/src/elements.browser.test.tsx`, `packages/render/src/same-but-place.test.ts` |
| NFR-PERF-002 | M | R3 | M16 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-PERF-003 | M | R1 | M11 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-PERF-004 | M | R4 | M21 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-PERF-005 | M | R2 | M13 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-PERF-006 | M | R0 | M3 | [30-non-functional.md](30-non-functional.md) | `packages/core/bench/transact-5000.bench.ts` +2 |
| NFR-PERF-007 | S | R8 | M32 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-PERF-008 | M | R4 | M21 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-SIZE-001 | M | R1 | M11 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-SIZE-002 | M | R1 | M11 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-SIZE-003 | M | R1 | M10 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-SIZE-004 | M | R1 | M10 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-SIZE-005 | S | R2 | M13 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-PORT-001 | M | R1 | M11 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-PORT-002 | M | R1 | M10 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-PORT-003 | M | R1 | M10 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-PORT-004 | M | R2 | M15 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-PORT-005 | M | R0 | M1 | [30-non-functional.md](30-non-functional.md) | `tests/harness/ci-evidence.test.mjs`, `tests/harness/ci-workflow.test.mjs` |
| NFR-PORT-006 | S | R8 | M32 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-REL-001 | M | R1 | M10 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-REL-002 | M | R0 | M2 | [30-non-functional.md](30-non-functional.md) | `packages/schema/src/parse-robust.test.ts` +2 |
| NFR-REL-003 | M | R0 | M3 | [30-non-functional.md](30-non-functional.md) | `packages/core/src/undo-property.test.ts` |
| NFR-REL-004 | M | R6 | M27 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-REL-005 | M | R0 | M2 | [30-non-functional.md](30-non-functional.md) | `packages/core/src/bootstrap.test.ts` +10 |
| NFR-SEC-001 | M | R1 | M10 | [30-non-functional.md](30-non-functional.md) | `packages/schema/src/rich-text.test.ts` |
| NFR-SEC-002 | M | R1 | M10 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-SEC-003 | M | R6 | M27 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-SEC-004 | M | R2 | M15 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-SEC-005 | M | R0 | M1 | [30-non-functional.md](30-non-functional.md) | `tests/harness/ci-evidence.test.mjs` +3 |
| NFR-SEC-006 | M | R1 | M11 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-SEC-007 | S | R6 | M28 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-A11Y-001 | M | R1 | M9 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-A11Y-002 | M | R1 | M11 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-A11Y-003 | M | R4 | M21 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-A11Y-004 | M | R1 | M11 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-A11Y-005 | S | R3 | M20 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-A11Y-006 | S | R2 | M15 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-I18N-001 | M | R1 | M9 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-I18N-002 | S | R8 | M32 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-I18N-003 | M | R8 | M32 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-MNT-001 | M | R0 | M1 | [30-non-functional.md](30-non-functional.md) | `tests/harness/layering.test.mjs` +2 |
| NFR-MNT-002 | M | R0 | M1 | [30-non-functional.md](30-non-functional.md) | `tests/harness/biome.test.mjs` +2 |
| NFR-MNT-003 | M | R0 | M1 | [30-non-functional.md](30-non-functional.md) | `tests/harness/biome.test.mjs`, `tests/harness/size.test.mjs` |
| NFR-MNT-004 | M | R0 | M1 | [30-non-functional.md](30-non-functional.md) | `apps/docs/src/index.test.ts` +20 |
| NFR-MNT-005 | S | R3 | M20 | [30-non-functional.md](30-non-functional.md) | `tests/harness/mutate.test.mjs` |
| NFR-MNT-006 | M | R0 | M3 | [30-non-functional.md](30-non-functional.md) | `packages/core/src/commands.test.ts` +5 |
| NFR-MNT-007 | M | R0 | M1, M33 | [30-non-functional.md](30-non-functional.md) | `packages/core/src/result-convention.test.ts` +2 |
| NFR-MNT-008 | M | R0 | M0 | [30-non-functional.md](30-non-functional.md) | `tests/harness/test-titles.test.mjs`, `tests/harness/trace.test.mjs` |
| NFR-AI-001 | M | R2 | M15 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-AI-002 | M | R2 | M14 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-AI-003 | M | R2 | M14 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-AI-004 | S | R2 | M15 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-OBS-001 | M | R1 | M11 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-OBS-002 | S | R1 | M11 | [30-non-functional.md](30-non-functional.md) | — |
| NFR-DX-001 | M | R0 | M1 | [30-non-functional.md](30-non-functional.md) | `tests/harness/budget.test.mjs` +2 |
| NFR-DX-002 | M | R0 | M1 | [30-non-functional.md](30-non-functional.md) | `tests/harness/budget.test.mjs` +5 |
| NFR-DX-003 | M | R0 | M0 | [30-non-functional.md](30-non-functional.md) | `tests/harness/adapters.test.mjs` +8 |
| NFR-DX-004 | M | R0 | M0 | [30-non-functional.md](30-non-functional.md) | `tests/harness/ci-workflow.test.mjs` +3 |
| NFR-LIC-001 | M | R0 | M1 | [30-non-functional.md](30-non-functional.md) | `tests/harness/licenses.test.mjs`, `tests/harness/workspace-shape.test.mjs` |
| NFR-LIC-002 | M | R0 | M1 | [30-non-functional.md](30-non-functional.md) | `tests/harness/drift.test.mjs` +2 |
| NFR-LIC-003 | M | R3 | M18 | [30-non-functional.md](30-non-functional.md) | — |
