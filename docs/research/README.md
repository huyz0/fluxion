# Research corpus

Compiled before any code (2026-09-26). **Upstream of requirements and architecture** — decisions
drawn from it are recorded in `docs/architecture/decisions/`. Search by keyword; don't load
wholesale (skill `research`). Items marked `(verify)` were not confirmed at the source.

| # | Document | Covers | Key recommendation |
|---|---|---|---|
| 00 | [Product analysis](00-product-analysis.md) | Problem, personas, ubiquitous language, pillars, metrics | Intersection of AI deck tools, diagram tools and web presentations |
| 01 | [Rendering & editor engines](01-rendering-and-editor-engines.md) | tldraw, Excalidraw, React Flow, JointJS, maxGraph, GoJS, Konva…; DOM/SVG vs Canvas/WebGL; store & undo patterns; shape libraries; connectors; mobile | Own engine on React DOM+SVG; learn from tldraw, don't depend on it (license) |
| 02 | [Layout & routing](02-layout-and-routing.md) | ELK, dagre, d3, WebCola, cytoscape, msagl; libavoid, A* routing; ports; overlap removal; templates; determinism; text measurement | Pluggable pipeline; permissive defaults (dagre, d3, WebCola, own A* router); ELK/libavoid optional |
| 03 | [Animation, interaction & presentation](03-animation-interaction-presentation.md) | Motion, GSAP (license), anime.js, WAAPI, View Transitions, morphing, path following, PowerPoint/Figma/Rive models, speaker view, a11y, perf | Own declarative model + scheduler; WAAPI + flubber; riders via offset-path → canvas |
| 04 | [File format, AI generation & theming](04-file-format-ai-generation-theming.md) | Single-file precedents, containers, assets, plugin embedding, schema/migrations; LLM generation, FluxScript DSL, MCP; DTCG tokens, OKLCH palettes, fonts | `.flux` zip + `.flux.html` player; FluxScript YAML DSL; DTCG tokens |
| 05 | [Engineering stack & tooling](05-engineering-stack-and-tooling.md) | Monorepo, build, lint, tests, CI/CD, docs, AI-friendly conventions, frontend stack | pnpm + Turborepo + Vite/tsdown + TS strict + Vitest/Playwright + Starlight |
| 06 | [AI harness](06-ai-harness-research.md) | oqueue harness, `/goal` in Claude & Codex, Ralph loop, portable skills, SDD frameworks | AGENTS.md + portable skills + gate-first milestone loop + hash-bound independent review |
| 07 | [Where the one-file player's bytes go](07-player-size.md) | Per-package weight of `player.inline.js` (M11.2): two server renderers and Zod are the removable bulk | Cut `react-dom/server` and Zod first; React's client is the floor |
