---
status: accepted
date: 2026-09-26
decision-makers: Fluxion maintainers
---

# ADR-0001 — Build our own engine on React DOM + SVG

## Context and Problem Statement

Fluxion needs one engine that edits and presents diagram-heavy screens. The same pixels must
appear in edit and present mode (FR-EDT-010), static HTML must be produced for info sites
(FR-SITE-002), React components must work as shapes (FR-CMP-001), and the player must be
embeddable in a single portable file under a 150 kB gzip budget (NFR-SIZE-001). Should we build
on an existing canvas or diagram SDK, or build our own?

## Decision Drivers

- Licence: exported files and sites must work anywhere, forever — no licence keys, watermarks or
  domain locks (NFR-LIC-002).
- WYSIWYG parity between editor, player, SSR site output and exports.
- React components as first-class elements, and accessibility of rendered content (NFR-A11Y-002).
- Control over the document model and file format (AI-first, CRDT-ready).
- Player size and performance targets (NFR-PERF-001/002).

## Considered Options

1. Build on the tldraw SDK
2. Build on React Flow / xyflow
3. Build on JointJS or maxGraph
4. Canvas/GPU engines (Konva, Fabric, Pixi, GoJS)
5. Own engine: React DOM + SVG, normalized records, signals

## Decision Outcome

Chosen option: **5 — own engine rendered with React DOM + SVG**. It is the only option that meets
the licence, WYSIWYG, SSR and component-shape drivers at the same time. We borrow patterns from
tldraw (records, bindings, tool statecharts, migrations), but we copy no code and add no
dependency on it.

### Consequences

- Good, because one `<ScreenView>` renders edit, present, SSR and export — parity by construction.
- Good, because DOM/SVG gives text selection, accessibility, CSS theming and static HTML for free.
- Good, because the file format and player size are fully under our control.
- Bad, because a solid core costs an estimated 6–10 engineer-months that an SDK would save.
- Bad, because very large screens need care (culling, per-record memoization, a canvas layer for
  riders) to reach NFR-PERF-002.

### Confirmation

Spike benchmarks (research 01 §7.4): 3 000 DOM shapes drag benchmark, present/edit parity check
for a React-component shape. Ongoing: performance gates in CI, and the `check-licenses` denylist
for watermark/key libraries.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| tldraw SDK | best-in-class editor architecture, fastest start | commercial licence key per deployment, watermark tiers, domain-locked keys conflict with exported sites; whiteboard UX to fight |
| React Flow | MIT, React nodes | node-graph model: no rotation, weak grouping/text/connectors; would be forked heavily |
| JointJS / maxGraph | rich connectors and routing | non-React idioms, key features paid (JointJS+), maxGraph 0.x |
| Canvas/GPU engines | raw performance | no React components, no accessible DOM, no static HTML |
| Own DOM + SVG | full control, parity, SSR, no licence tax | upfront effort |

## More Information

Research: `docs/research/01-rendering-and-editor-engines.md` §1, §2, §7. Architecture:
`../01-overview.md` §3, `../04-rendering-and-editor.md`.
