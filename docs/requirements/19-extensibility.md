# 19 — Extensibility (Plugins, Packs, Component Elements)

Areas: `EXT` (plugin system), `CMP` (React component elements), `PKG` (packaging).

Everything first-party (built-in shapes, routers, layouts, themes, effects, tools, importers,
exporters) must be implemented **through the same extension APIs** available to third parties
("dogfooding rule").

## EXT — Plugin system

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-EXT-001 | M | R0 | Internal registry pattern: typed registries for element kinds, shape definitions, routers, layouts, markers, effects, transitions, themes, fonts, commands, tools, panels, importers, exporters, DSL macros. | Core built-ins registered via registry (lint rule forbids hard-coded kind switches). |
| FR-EXT-002 | M | R6 | Plugin manifest (`fluxion-plugin.json`): id (reverse-DNS), version (semver), engine range, contributions, permissions, entry points (player vs editor), license. | Manifest schema validation. |
| FR-EXT-003 | M | R6 | Two runtime surfaces: **player contributions** (render-time: elements, effects, routers, layouts, components) and **editor contributions** (tools, panels, inspectors, commands, importers). Player contributions must not import editor code. | Bundle check: player plugin chunk has no editor deps. |
| FR-EXT-004 | M | R6 | Plugin lifecycle: install, enable/disable, update, uninstall; activation events (lazy load on first use of a contributed kind). | Unused plugin code not loaded (network/log check). |
| FR-EXT-005 | M | R6 | Versioned public API (`@fluxion/sdk`) with API report; breaking changes only in major versions. | API Extractor report checked in CI. |
| FR-EXT-006 | M | R6 | Plugin dev experience: `fluxion plugin create` scaffold, dev server with hot reload into studio, test utilities, docs. | Scaffolded plugin runs in dev studio in < 1 min. |
| FR-EXT-007 | S | R6 | Plugin settings (schema-defined) stored per document or per user. | Settings UI generated from schema. |
| FR-EXT-008 | M | R6 | **Missing-plugin resilience**: opening a document whose plugin is unavailable shows placeholders (with fallback snapshot image if saved) and preserves data. | Doc renders fallback SVG snapshot; save preserves data. |

## CMP — React component elements

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-CMP-001 | M | R6 | A plugin can register a **component element kind**: React component + props schema + default size + anchors (static or dynamic) + optional editor inspector. | Registered component draggable from library, props editable via generated inspector. |
| FR-CMP-002 | M | R6 | Component contract: receives props (validated), theme tokens, mode (`edit`/`present`), screen/step state, variables (read), size; can emit events (triggers) and expose methods (actions); can declare animations it supports. | Contract test harness in SDK validates a component. |
| FR-CMP-003 | M | R6 | Components can be used as **shapes**, **connector decorations/labels**, **riders**, and **popup content**. | One example of each in examples/. |
| FR-CMP-004 | M | R6 | In edit mode components render live but pointer events are captured by the editor unless the element is "entered" (double-click) or flagged `interactiveInEdit`. | E2E: clicking chart in edit selects it; entering allows interaction. |
| FR-CMP-005 | M | R6 | Components must be serializable by props only (state that must persist goes into props/variables). | Contract test: remount with same props → same render. |
| FR-CMP-006 | S | R6 | Static fallback: on save, a component can render an SVG/PNG snapshot used by exporters and when the plugin is unavailable. | Export PDF includes component snapshot. |
| FR-CMP-007 | M | R6 | Error isolation: a crashing component shows an error placeholder and does not break the screen/editor (error boundary). | Throwing component → placeholder; rest renders. |

## PKG — Packaging

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-PKG-001 | M | R6 | Plugin package format (`*.fluxpack`): manifest + ESM bundles (player, editor) + assets + integrity hashes. | `fluxion pack` builds; install verifies hashes. |
| FR-PKG-002 | M | R6 | **Embedding**: saving a doc embeds the *player* bundle of each plugin actually used (not editor bundle), deduplicated by hash. | File includes only used plugin player code. |
| FR-PKG-003 | M | R6 | Trust model: first-party & user-trusted plugins run in page context; untrusted embedded code runs sandboxed (iframe with restrictive CSP) or is blocked with user prompt. | Untrusted plugin cannot access parent DOM/storage (security test). |
| FR-PKG-004 | S | R6 | Shared dependencies (React, SDK) provided by host via import map; plugins must not bundle React. | Plugin bundle check rejects bundled React. |
| FR-PKG-005 | S | R8 | Plugin registry index format (static JSON) for discovery; signing with publisher keys. | Signed plugin verified on install. |
