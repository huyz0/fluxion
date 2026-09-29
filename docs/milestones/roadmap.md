# Roadmap

> Read when: choosing what milestone is current, starting `/goal`, or planning.
> Every milestone has a **completion command**. A milestone is done when its command exits 0
> *and* a milestone review (fresh agent) has recorded a verdict. The command is written first,
> red (see `docs/standards/sdd.md`, skill `plan-milestone`).

**Current milestone: `M6`** (the `drive` skill reads this line).

Plans (`M<n>.md`) are hypotheses with ≤ ~20 tasks; the backlog (`docs/backlog/current.md`) is
authoritative for the current milestone only.

## Milestones

| ID | Milestone | Inc | Depends | Requirement scope (primary) | Completion command |
|---|---|---|---|---|---|
| [M0](M0.md) | Harness bootstrap & verification | R0 | — | NFR-DX-003, NFR-DX-004, NFR-MNT-008 | `node scripts/gates/m0-complete.mjs` |
| [M1](M1.md) | Monorepo & toolchain skeleton | R0 | M0 | NFR-MNT-001/002/003/004/007, NFR-PORT-005, NFR-DX-001/002, NFR-SEC-005, NFR-LIC-001/002 | `node scripts/gates/m1-complete.mjs` |
| [M2](M2.md) | Schema & geometry foundations | R0 | M1 | FR-DOC-001..005, FR-DOC-010, FR-SCR-001, FR-SHP-001, FR-CON-001, NFR-REL-002, NFR-REL-005 | `node scripts/gates/m2-complete.mjs` |
| [M3](M3.md) | Core engine: store, commands, undo, registries | R0 | M2 | FR-EXT-001, FR-EDT-006 (core), NFR-REL-003, NFR-PERF-006, NFR-MNT-006 | `node scripts/gates/m3-complete.mjs` |
| [M4](M4.md) | Static renderer & CLI v0 — **R0 exit** | R0 | M3 | FR-CLI-001, FR-SCR-001 (render), FR-THM-001 (minimal) | `node scripts/gates/m4-complete.mjs` |
| [M5](M5.md) | Shapes, anchors & basic connectors | R1 | M4 | FR-SHP-002..006, FR-SHP-012, FR-CON-002/003/005/006/012, FR-ANC-001/002, FR-RTE-001 | `node scripts/gates/m5-complete.mjs` |
| [M6](M6.md) | Editor shell, canvas & selection | R1 | M5 | FR-EDT-001..005, FR-EDT-009, FR-EDT-010, FR-EDT-019, NFR-PERF-001 | `node scripts/gates/m6-complete.mjs` |
| [M7](M7.md) | Editing essentials: text, inspector, clipboard, commands | R1 | M6 | FR-EDT-006..008, FR-EDT-011..013, FR-EDT-021, FR-TXT-001..004, FR-CON-007, FR-SHP-003 | `node scripts/gates/m7-complete.mjs` |
| [M8](M8.md) | Arrange, screens & library v1 | R1 | M7 | FR-ARR-001..005, FR-LIB-001/002, FR-SCR-002/003/004/006 | `node scripts/gates/m8-complete.mjs` |
| [M9](M9.md) | Theme & fonts v1 | R1 | M5 (engine), M6 (UI rows) | FR-THM-001..004, FR-THM-008, FR-DOC-006, NFR-I18N-001, NFR-A11Y-001 | `node scripts/gates/m9-complete.mjs` |
| [M10](M10.md) | File format & persistence | R1 | M8, M9 | FR-FIL-001..004, FR-FIL-006..009, FR-AST-001/002/005, FR-EXP-001, NFR-SIZE-003/004, NFR-SEC-001/002, NFR-REL-001, NFR-PORT-002/003 | `node scripts/gates/m10-complete.mjs` |
| [M11](M11.md) | Player v1 & MVP release — **R1 exit** | R1 | M10 | FR-PRS-001..006, FR-PRS-009, FR-RSP-001, FR-RSP-007, NFR-SIZE-001/002, NFR-PERF-003, NFR-A11Y-002/004, NFR-PORT-001, NFR-OBS-001/002, NFR-SEC-006 | `node scripts/gates/m11-complete.mjs` |
| [M12](M12.md) | FluxScript DSL compiler | R2 | M11 | FR-DSL-001/002/005/006/009, FR-FIL-005, FR-EDT-022, FR-AI-010 | `node scripts/gates/m12-complete.mjs` |
| [M13](M13.md) | Layout engine v1 | R2 | M12 | FR-LAY-001/002/004/005/007/008, FR-DOC-007, NFR-PERF-005 (layout), NFR-SIZE-005 | `node scripts/gates/m13-complete.mjs` |
| [M14](M14.md) | AI toolkit & CLI v1 | R2 | M13 | FR-AI-001..006, FR-AI-011, FR-CLI-002, FR-CLI-005, FR-EXP-007/008, NFR-AI-002/003 | `node scripts/gates/m14-complete.mjs` |
| [M15](M15.md) | MCP server, AI assistant & evals — **R2 exit** | R2 | M14 | FR-MCP-001/002, FR-EDT-014, FR-AI-007, FR-AI-009, FR-DSL-007, FR-IMP-001/002, FR-AST-006, NFR-AI-001/004, NFR-SEC-004, NFR-A11Y-006, NFR-PORT-004 | `node scripts/gates/m15-complete.mjs` |
| [M16](M16.md) | Anchors & smart routing | R3 | M15 | FR-ANC-003..007, FR-CON-004/008/009/011, FR-RTE-002..004, NFR-PERF-002 | `node scripts/gates/m16-complete.mjs` |
| [M17](M17.md) | Layout suite v2 & smart templates | R3 | M16 | FR-LAY-003/006/010/011/012/014 | `node scripts/gates/m17-complete.mjs` |
| [M18](M18.md) | Shape library, packs & import | R3 | M15 | FR-LIB-003..009, FR-LIB-011, FR-CON-010, FR-AST-003, NFR-LIC-003 | `node scripts/gates/m18-complete.mjs` |
| [M19](M19.md) | Advanced editing: containers, layers, paths, tables, masters | R3 | M18 | FR-ARR-006..008, FR-SHP-007..011, FR-SHP-014, FR-SCR-005, FR-EDT-015/016 | `node scripts/gates/m19-complete.mjs` |
| [M20](M20.md) | Theme studio, SVG export & DSL round-trip — **R3 exit** | R3 | M17, M19 | FR-THM-005/006/007/009, FR-EXP-004, FR-DSL-008, NFR-A11Y-005, NFR-MNT-005 | `node scripts/gates/m20-complete.mjs` |
| [M21](M21.md) | Animation runtime & effects | R4 | M20 | FR-ANI-001..008, FR-ANI-011, NFR-PERF-004/008, NFR-A11Y-003 | `node scripts/gates/m21-complete.mjs` |
| [M22](M22.md) | Builds, transitions, morph & layout animation | R4 | M21 | FR-TML-001..005, FR-TRN-001/002/004, FR-MRP-001/002, FR-LAY-009, FR-PRS-007, FR-EDT-017, FR-DSL-003 | `node scripts/gates/m22-complete.mjs` |
| [M23](M23.md) | Connector flows, riders & rich media — **R4 exit** | R4 | M22 | FR-RDR-001..005, FR-FLW-001..003, FR-CON-013, FR-ANI-009/010, FR-TXT-005/007, FR-AST-004, FR-AI-008 | `node scripts/gates/m23-complete.mjs` |
| [M24](M24.md) | Interaction engine, popups & variables | R5 | M23 | FR-INT-001..006, FR-INT-010, FR-DOC-008, FR-DSL-004 | `node scripts/gates/m24-complete.mjs` |
| [M25](M25.md) | Drill-down, screen states & presenter tools — **R5 exit** | R5 | M24 | FR-SCR-007/008, FR-TRN-003, FR-INT-007/008/009/011, FR-SPK-001..003, FR-PRS-008, FR-EDT-018, FR-MCP-003 | `node scripts/gates/m25-complete.mjs` |
| [M26](M26.md) | Plugin SDK & developer workflow | R6 | M25 | FR-EXT-002..007, FR-CLI-003, FR-LIB-010 | `node scripts/gates/m26-complete.mjs` |
| [M27](M27.md) | Component elements, packaging & sandbox | R6 | M26 | FR-CMP-001..007, FR-PKG-001..004, FR-ANC-008, FR-EXT-008, FR-SHP-013, FR-FIL-010, NFR-SEC-003, NFR-REL-004 | `node scripts/gates/m27-complete.mjs` |
| [M28](M28.md) | Built-in components, embeds & data bindings — **R6 exit** | R6 | M27 | FR-SHP-015/016, FR-DOC-009, FR-THM-011, FR-TXT-008, NFR-SEC-007 | `node scripts/gates/m28-complete.mjs` |
| [M29](M29.md) | Responsive & mobile reflow | R7 | M28 | FR-RSP-002..006, FR-LAY-013, FR-THM-010 | `node scripts/gates/m29-complete.mjs` |
| [M30](M30.md) | Exporters: PDF, PNG, PPTX, video | R7 | M29 | FR-EXP-002/003/005/006 | `node scripts/gates/m30-complete.mjs` |
| [M31](M31.md) | Static info site & importers — **R7 exit** | R7 | M30 | FR-SITE-001..004, FR-CLI-004, FR-IMP-003/004/005 | `node scripts/gates/m31-complete.mjs` |
| [M32](M32.md) | Hardening: a11y, i18n, performance, security | R8 | M31 | FR-TXT-006, FR-FIL-011, FR-EDT-020/023, NFR-I18N-002/003, NFR-PORT-006, NFR-PERF-007, all NFR re-audit | `node scripts/gates/m32-complete.mjs` |
| [M33](M33.md) | 1.0 release: API & format freeze, docs, gallery — **R8 exit** | R8 | M32 | FR-PKG-005, FR-SITE-005, NFR-MNT-007 (freeze), all increments' exit criteria | `node scripts/gates/m33-complete.mjs` |

## Dependency graph (critical path in bold)

```
M0 → M1 → M2 → M3 → M4 → M5 ─┬→ M6 → M7 → M8 ─┐
                               └→ M9 ───────────┴→ M10 → M11 → M12 → M13 → M14 → M15
M15 ─┬→ M16 → M17 ─────────────┐
     └→ M18 → M19 ─────────────┴→ M20 → M21 → M22 → M23 → M24 → M25 → M26 → M27 → M28
M28 → M29 → M30 → M31 → M32 → M33
```
Parallelizable pairs (separate worktrees/agents): M6‖M9 (M9 engine rows only; its UI rows wait for M6), M16‖M18, M17‖M19. Everything else
is sequential because later milestones build on earlier contracts.

## Increment exits

| Inc | Exit milestone | Demo document (committed under `examples/`) |
|---|---|---|
| R0 | M4 | `examples/r0-static.flux.json` rendered by CLI to HTML |
| R1 | M11 | `examples/r1-mvp-deck.flux.html` (5 screens, hand-made) |
| R2 | M15 | `examples/r2-ai-deck.flux.yaml` + generated `.flux.html` via MCP transcript |
| R3 | M20 | `examples/r3-architecture.flux.html` (60 nodes, orthogonal, no overlap) |
| R4 | M23 | `examples/r4-power-grid.flux.html` (riders, flows, magic move) |
| R5 | M25 | `examples/r5-system-map.flux.html` (popups, drill-down, speaker view) |
| R6 | M28 | `examples/r6-plugin-demo.flux.html` + `examples/packs/acme-charts` |
| R7 | M31 | `examples/r7-site/` static site + mobile portrait screenshots |
| R8 | M33 | Gallery of 10 examples; docs site; 1.0 packages |

## Deferred into a later milestone

When a milestone review hands an item to a later milestone, record it here **and** in the
receiving milestone's plan.

| Item | From | To | Reason |
|---|---|---|---|
| Grow on text edit: the text-edit command applies `fitShapeText`'s grow height (ADR-0018 item 4) (M5 final F3) | M5 | M7 | the edit command arrives there |
| Renumber the ADRs planned in M6-M9 from ADR-0020 (M5 used 0017-0019); ADR legs match titles (M5 final F4) | M5 | M6 (planning, first) | plan text only |
| Router contract end check, one routers registry, duplicate routing/render helpers (M5 final F6) | M5 | M16 | routers and custom anchors |
| A procedural pattern paint (hatch, dots, no asset): M5 reads FR-SHP-004's "pattern" as an image paint with `fit: tile`; a pattern of its own needs a `Paint` schema change (format contract, ADR) (M5.13 review F4) | M5 | M9 | a paint and schema decision, with themes |
| check-tests-kept: detect vitest `skipIf`/`runIf`/`concurrent.skip` and net-swap of cases; add Biome noFocusedTests/noSkippedTests (cp1 F4) | M0 | M1 | vitest and Biome arrive in M1 |
| `/goal` dry runs in interactive Claude Code and Codex sessions (M0.14/M0.15; kit in docs/harness/kits/dry-run.md), including the live Codex-session check moved there from M0.11 (13 skills via `/skills`, PostToolUse quick gate observed) — descoped by user decision; reviews use subagents only | M0 | unscheduled (on human request) | user decision 2026-09-26 |
| Close descoping loophole: a `descoped (...)` State change is never review-exempt; its reason must cite an ADR or Deferred entry (M0 final F1) | M0 | M1 (first) | shared gate code reused by later milestones |
| `gates.yml`: actionlint clean + first push green on 3 OSes; guide CI item required before M1 CI work (M0 final F2) | M0 | M1 row 18 (early) | never linted or run |
| Function-length/complexity caps owned by Biome, not check-size; M1 row 9 reworded accordingly (check-size keeps the file cap from M0.6) (cp1 F5) | M0 | M1 | tools land in M1 |
| check-tests-kept counts released format fixtures as tests (contracts.md rule 10; `isTest` excludes `fixtures/` today) (M1 cp2 F3) | M1 | M2 (row 16, shared fixtures) | fixtures arrive in M2 |
| NFR-SEC-005 dependency review and CodeQL are inactive until repo variable `CODE_SCANNING` is set (the repo is private by user decision 2026-09-26, so no GitHub Code Security); vulnerabilities are enforced meanwhile by OSV-Scanner on every PR/push (any known advisory, not only new) and licences by check-licenses (M1 final F1) | M1 | M11 (before the first public release) | needs a human repo/licence decision |
| Release enablement: unreleased packages private or a pending-changeset guard, publish job behind the `npm` environment, npm trusted publishing, App token for the Version Packages PR (M1 final F2, M1.21 F1/F2, M1.39) | M1 | M11 | first release is M11 |
| CI evidence must cover the final review range end, not any sha after M1.21 (M1 final F3/D1) | M1 | M2 | gate code; M1's record was re-taken at c9f4fab, the final range end, in M1.41 |
| One Result/error convention across pure packages (M2 final F3) | M2 | M3 (first) | core consumes schema and geometry |
| docs-consistency checks schema → catalogue too (M2 final F4) | M2 | M3 | M3 adds record fields |
| check-ci-evidence reports stale evidence before transport errors (M2 final F5) | M2 | M3 | gate diagnostics |
| fast-check out of @fluxion/schema runtime deps before publishing (M2 final F6) | M2 | M11 | first release is M11 |
| Valid fixtures behave as named (unknown-kind warns FLX_KIND_UNKNOWN) (M2 final F7) | M2 | M3 | fixture test strength |
| Budget re-record path for agents after a lockfile change; cold setup on windows/macos (ADR-0143) (M2 delta D1, D3) | M2 | M3 | needs a design decision |
| Undo/transact benches in a shared milestone bench leg or nightly perf (M3 final F1) | M3 | M4 | benches run only in m3-complete |
| Core pre-release hardening: no undo/redo origin through commands, determinism test, argument error codes, non-lexical write-path test (M3 final F2, F4, F5, F6) | M3 | M4 (first) | before render consumes core |
| One wired core bootstrap (registries with built-ins + store with hooks) (M3 final F3) | M3 | M4 | first consumer is render |
| Mutation testing with tzap instead of StrykerJS (ADR), triage of the 187 M3 survivors | M3 | M4 (first) | user decision 2026-09-28 |
| Completion gates share one CI-unset verify leg with a harness test (M2.29 review F1, F2) | M2 | M3 | gate code |
| Cold-setup CI job + `check-budget --record` isolation test (M1 final F4); one three-OS verify matrix instead of gates.yml + ci.yml, restoring windows headroom under the 15-min budget (M1 final F5, D5) | M1 | M2 | CI hygiene |
| Drive loop reads the last push's CI conclusion before a task (M4 final F3) | M4 | M5 (first) | process |
| Changeset leg derives packages from the range; renderDocumentToHtml returns rendered screen ids; test:visual without --pass-with-no-tests (M4 final F1, F2, F4) | M4 | M5 | gate honesty, coherence |
| The studio registers packs/basic (M5 plan row 3; M5.1 review F5) | M5 | M6 | the studio renders no document before its M6 bootstrap |
| Connector labels render rich-text marks, links and lists (FR-CON-006; M5.1 review F5) | M5 | M7 | the text engine arrives in M7 |
