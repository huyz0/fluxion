# 00 — Product Analysis: Fluxion

> Status: Research input · Date: 2026-09-26 · Owner: AI harness (see `AGENTS.md`)

## 1. Problem statement

Existing tools force a choice:

| Tool family | Good at | Falls short on |
|---|---|---|
| Slide tools (PowerPoint, Keynote, Google Slides) | Linear decks, build animations | Diagrams are second-class, connectors are dumb lines, no real interactivity, proprietary formats, poor on mobile |
| AI deck tools (Gamma, Tome, Beautiful.ai, Pitch) | Fast AI first draft, responsive cards | Limited diagramming, closed formats, little per-element interactivity, no extension model |
| Diagram tools (draw.io, Lucid, Excalidraw, tldraw, Miro) | Shapes, connectors, libraries | Weak presentation mode, little animation, no "story" through a diagram |
| Web frameworks (reveal.js, Slidev, Spectacle) | Code-driven, web-native, interactive | Not visual editing, not approachable for non-developers, diagrams via Mermaid images only |
| Prezi | Spatial zooming narrative | Closed, dated authoring model, weak diagrams |

**Fluxion** targets the intersection: a *document of interactive, animated diagram-screens* that
AI can generate from intent, humans can refine visually, and anyone can present full-screen on
desktop or browse on mobile — shipped as a **single portable file**.

## 2. Primary personas

| Persona | Goal | Key needs |
|---|---|---|
| **AI agent** (LLM via API/MCP/CLI) | Generate a deck/site/diagram from a prompt or source material | Compact schema/DSL, no coordinate math (auto layout), validation with repair hints, deterministic render |
| **Author / editor** | Refine AI output, build from scratch | Drag & drop from a big shape library, snapping, align/group, themes, WYSIWYG with present mode |
| **Presenter** | Deliver a talk | Full-screen, keyboard/clicker, speaker view, interactive drill-down, reliable offline |
| **Viewer (mobile/desktop)** | Consume a shared file or site | Opens anywhere (browser), touch navigation, readable on portrait phones, accessible |
| **Extension developer** | Add shapes, connectors, layouts, themes, components | Typed SDK, manifest, hot reload, sandboxing, packaging into the file |

## 3. Core concepts (ubiquitous language)

| Term | Meaning |
|---|---|
| **Document** | The whole file: metadata, theme, screens, assets, plugins |
| **Screen** | One presentable canvas (slide / page / scene). Has a logical size, a background, elements, states and a timeline |
| **Element** | Anything on a screen: *Shape*, *Connector*, *Group*, *Text*, *Image*, *Component* |
| **Shape** | A node with geometry from a *shape definition* (library entry), style, text, and *anchors* |
| **Anchor (port)** | A named attachment point on a shape — fixed (fractional), side-based, or dynamic (perimeter projection) |
| **Connector** | A line between two endpoints (anchors or free points) with a *route* type (straight, curved, orthogonal, polyline), markers, labels, and optional *riders* |
| **Rider (sub-shape)** | A shape/component that travels along a connector path (e.g. electron on a wire) |
| **Layout** | A pluggable algorithm that positions elements (layered, tree, force, grid, radial…) and routes connectors |
| **Theme** | Design tokens: palette, typography, spacing, radii, effects, default styles per shape kind |
| **Animation** | Declarative keyframed effect on a property (color, border, glow, morph, path, opacity, transform) |
| **Timeline / Build** | Ordered steps on a screen, each triggered (on click, after previous, with previous, on event) |
| **Interaction** | Trigger → action rules (on click → navigate / show popup / play timeline / set state / zoom-to) |
| **Mode** | *Edit* (all editing tools; preview of animations) vs *Present* (edit locked, interactions live) |
| **Plugin / Pack** | Versioned bundle contributing shapes, connectors, layouts, themes, fonts, components, tools |
| **Player** | The minimal runtime that renders and presents a document (no editor code) |

## 4. Product pillars

1. **AI-first authoring** — intent-level schema + DSL; the machine never needs pixel math; validation gives repair-ready errors; MCP/CLI access.
2. **Diagrams as first-class citizens** — shapes with anchors, smart connectors, auto layout and routing.
3. **Alive screens** — animation timelines, connector flows, riders, morphs, interactive popups and drill-downs.
4. **WYSIWYG parity** — the editor renders with the same renderer as the player; edit mode is an overlay, not a different renderer.
5. **Portable & small** — one file, opens in any modern browser, re-editable, content-addressed assets, compressed.
6. **Extensible everywhere** — shapes, connectors, routers, layouts, animations, themes, fonts, tools, importers/exporters, components.
7. **Responsive** — desktop full-screen and mobile portrait, via scaling and optional per-breakpoint re-layout.

## 5. Differentiators to protect

- Connector *riders* and animated flows (visual storytelling of systems — power, data, money, process).
- Auto-layout-aware animation: layout changes animate (FLIP) so AI "rearrange" looks intentional.
- Single-file HTML that is both a *presentation* and an *editable source*.
- One schema used by AI, editor, player, CLI, and exporters.

## 6. Out of scope for v1 (explicitly deferred)

- Real-time multiplayer collaboration (the data model must stay CRDT-friendly so it can be added later).
- Server-side accounts/hosting/marketplace (local-first; static hosting only).
- Video editing / audio timelines beyond simple embedded media.
- Native desktop app (a Tauri wrapper is a later option).

## 7. Success metrics (initial targets)

| Metric | Target |
|---|---|
| AI one-shot validity (generated doc validates without repair) | ≥ 90 % on the eval set; ≥ 99 % after one repair round |
| Time from prompt to presentable 10-screen deck | < 60 s (excluding LLM latency variance) |
| Player bundle (gzip) | ≤ 150 kB core, lazy chunks for heavy features |
| Typical 20-screen document file size (no photos) | ≤ 300 kB single HTML incl. player |
| Present-mode frame rate on mid-range phone | ≥ 55 fps for standard animations |
| Edit/present visual parity | Pixel-diff ≤ 0.1 % in visual regression suite |
