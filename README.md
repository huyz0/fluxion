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

> Status: **pre-code**. Research, requirements, architecture, standards, AI harness and
> milestones are in place; implementation starts at milestone M0/M1.

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

```bash
node scripts/harness/setup.mjs
```

Then in Claude Code or Codex, start the milestone loop with the goal text in
[.agents/skills/drive/references/goal-template.md](.agents/skills/drive/references/goal-template.md)
(`/goal Drive milestone M0 …`). See [AGENTS.md](AGENTS.md) for the rules the loop obeys.

## License

MIT (planned — NFR-LIC-001).
