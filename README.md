# Fluxion

Author, AI-generate and present **interactive, animated diagram-screens** — full-screen decks,
mobile views and static info sites — saved as **one portable file** (`.flux.html` opens and
presents in any browser; `.flux` is the compact editable package).

- Rich, extensible shape library; import SVG / Iconify / draw.io libraries
- Smart connectors (straight, curved, orthogonal, polyline) with multi-anchor & dynamic anchors
- Auto layout and obstacle-avoiding routing — no overlaps, deterministic, animated
- Animations: effects, builds, morph/magic-move, flowing connectors, riders travelling along lines
- Interactions: popups, drill-down zoom, branching, variables, speaker view
- React-component elements and a plugin SDK for shapes, connectors, layouts, themes, effects
- AI-first: FluxScript DSL, JSON Schema, CLI, MCP server, validate-repair loop

> Status: **toolchain skeleton** (M1). The monorepo, gates, test runners, Storybook, docs site
> and CI are in place; product code starts at milestone M2 (schema & geometry).

## Quickstart

Needs Node ≥ 22.19 and pnpm 11 (`corepack enable` picks the version pinned in `package.json`).
Windows, macOS and Linux are all supported.

```bash
pnpm i
pnpm run setup
pnpm verify
```

`pnpm run setup` points git at the repo's hooks, generates the Claude skill adapters and installs
Playwright's Chromium, which the Vitest browser project needs (`pnpm setup` without `run` is a
pnpm built-in). `pnpm verify` runs the full pre-commit ladder that CI runs; `pnpm verify:fast`
is the quick subset while iterating.

| Command | What |
|---|---|
| `pnpm run build` | Build every workspace (Turborepo, cached) |
| `pnpm test` / `pnpm test:coverage` | Unit and property tests (Vitest, node + browser) |
| `pnpm test:e2e --project=chromium` | Playwright end-to-end suite against the built studio, Chromium only |
| `pnpm test:e2e` | All five projects (desktop and mobile Chromium, Firefox, WebKit): run `pnpm exec playwright install` first |
| `pnpm --filter @fluxion/docs run dev` | Docs site (Astro Starlight) |

## Repository map

| Path | What |
|---|---|
| [AGENTS.md](AGENTS.md) | Entry point for AI agents (Claude Code reads it via `CLAUDE.md`) |
| [docs/research](docs/research) | Research corpus (engines, layout/routing, animation, file format & AI, stack, harness) |
| [docs/requirements](docs/requirements/README.md) | Functional & non-functional requirements, increments R0–R8 |
| [docs/architecture](docs/architecture/README.md) | Architecture, package map, ADRs |
| [docs/standards](docs/standards/README.md) | Coding, design, testing, git, CI/CD, docs, review, SDD standards |
| [docs/milestones](docs/milestones/roadmap.md) | Roadmap M0–M33 with completion gates |
| [docs/backlog](docs/backlog/current.md) | Current milestone's tasks |
| [.agents/skills](.agents/skills/README.md) | Portable AI skills (Claude + Codex) |
| [scripts](scripts) | Gates and harness scripts (Node, cross-platform) |

## Developing with AI agents

After the quickstart, in Claude Code or Codex, start the milestone loop with the goal text in
[.agents/skills/drive/references/goal-template.md](.agents/skills/drive/references/goal-template.md)
(`/goal Drive milestone M0 …`). See [AGENTS.md](AGENTS.md) for the rules the loop obeys.

## License

MIT (planned — NFR-LIC-001).
