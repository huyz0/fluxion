# Documentation

> Read when: changing behaviour, a public API, a contract, a package's purpose, or a standard;
> adding a package; writing an ADR; or editing anything under `docs/`, `apps/docs/`, or an
> `AGENTS.md`/`README.md`.
> Family: Delivery · Related: [contracts.md](contracts.md), [sdd.md](sdd.md), [git.md](git.md)

Docs are code: versioned beside what they describe, reviewed with it, and checked by scripts
where a claim can be checked. For an agent-built project they are also the context the next
session loads, so stale docs directly produce wrong code.

## 1. Where things live

| Audience | Location | Content | Built by |
|---|---|---|---|
| Agents (every session) | `AGENTS.md` (≤ 250 lines), `CLAUDE.md` = `@AGENTS.md` | index: start-here links, standards table, skills table, non-negotiables, commands | `build-index.mjs` for tables |
| Agents (per package) | `packages/<pkg>/AGENTS.md` (≤ 60 lines) | invariants, allowed deps, test tier, gotchas | hand-written |
| Contributors | `docs/research/` | cited research; upstream input, not normative | hand-written |
| Contributors | `docs/requirements/` | FR/NFR IDs, acceptance, traceability matrix | hand-written, via spec + ADR |
| Contributors | `docs/architecture/` + `decisions/ADR-NNNN-slug.md` | overview, C4 diagrams as code, MADR 4 ADRs | hand-written; diagrams rendered in CI |
| Contributors | `docs/standards/` | how we work (this folder) | hand-written; index generated |
| Contributors | `docs/milestones/`, `docs/backlog/`, `specs/` | roadmap, plans, current backlog, change folders | [sdd.md](sdd.md) |
| Users & plugin devs | `apps/docs` (Astro Starlight) | guides, file-format reference, FluxScript reference, plugin SDK, upgrading | `pnpm docs:build` |
| API consumers | TypeDoc into `apps/docs/reference/`; `packages/*/api/*.api.md` | generated from TSDoc | `pnpm api` |
| LLMs | `llms.txt`, `llms-full.txt`, `llms-small.txt` | generated from `apps/docs` | `starlight-llms-txt` |
| npm readers | `packages/<pkg>/README.md`, `CHANGELOG.md` | purpose, install, 10-line example; changelog from changesets | Changesets |

## 2. Rules

| # | Rule | Enforced by |
|---|---|---|
| 1 | **Docs change in the same commit as the behaviour they describe.** A task that changes user-visible behaviour, a contract, or a command updates the relevant page. | reviewer; `check-drift.mjs` for generated artefacts |
| 2 | Every exported symbol of a published package has TSDoc: summary, `@param`/`@returns` where non-obvious, a release tag, and `@example` for SDK entry points. | API Extractor (`ae-missing-release-tag`, `ae-undocumented` as errors) |
| 3 | API reports `packages/*/api/*.api.md` are regenerated and committed with any public API change. | `api` CI job |
| 4 | Every package has `README.md` and `AGENTS.md`. | `check-portability.mjs` |
| 5 | Every standard starts with a `> Read when:` line; numbered rules name their gate or say `no gate — judgement`. | `build-index.mjs --check` |
| 6 | Index tables between `<!-- index:<name>:start -->` / `<!-- index:<name>:end -->` markers are generated; never edit them by hand. | `build-index.mjs --check` |
| 7 | A doc sentence claiming a checkable fact ("every gate named here exists", "all packs declare a license") is verified by a script, or deleted. | `check-portability.mjs` (both directions) |
| 8 | ADRs use MADR 4 (`Context and Problem Statement`, `Considered Options`, `Decision Outcome`, `Consequences`). Numbering is sequential and never reused. Superseding an ADR edits only its `Status` line. A correction of detail that keeps the decision (a version, a tool route) is a dated line in an `## Amendments` section, never a silent in-place edit; a changed decision needs a superseding ADR. | `check-drift.mjs` (ADR headers) |
| 9 | Architecture diagrams are text (LikeC4 / Mermaid C4) in `docs/architecture/diagrams/`; no binary diagrams in the repo. | `check-size.mjs` (rejects `*.png` under `docs/architecture`) |
| 10 | User docs are generated from source where possible: JSON Schema reference from `@fluxion/schema`, catalog pages from registries, CLI reference from command definitions. | `pnpm docs:build` drift check |
| 11 | Code examples in `apps/docs` are compiled/tested (`docs/examples/*.ts` imported into MDX, or DSL snippets run through `fluxion validate`). | `docs-examples` test project |
| 12 | Every publishable package change carries a changeset whose summary is written for users, not reviewers. | Changesets CI check |
| 13 | Length caps: `AGENTS.md` ≤ 250 lines, package `AGENTS.md` ≤ 60, standards ≤ 220, skills ≤ 150, `backlog/current.md` ≤ 400. | `check-size.mjs` |

## 3. Writing style

- Lead with the rule or the answer; reasons after, examples last.
- Tables over prose for anything with ≥ 3 parallel items.
- One idea per sentence. Plain words. No warning emojis, no bold-everything.
- Name files and commands exactly (`node scripts/gates/check-trace.mjs`) so an agent can run them.
- Say what is *not* covered rather than implying completeness.
- Research docs summarize sources in our own words and cite them; no long quotations.
- Link, don't copy: a fact lives in one place and others link to it.

## 4. TSDoc example

```ts
/**
 * Routes a connector between two anchors, avoiding obstacle bounding boxes.
 *
 * @param request - Source/target anchors, obstacles, and routing style.
 * @returns Axis-aligned polyline in document coordinates, or `null` when no route exists.
 * @example
 * const route = orthogonalRouter.route({ from, to, obstacles, style: 'orthogonal' });
 * @public
 */
export function route(request: RouteRequest): Route | null;
```

## 5. When to write what

| Situation | Write |
|---|---|
| Decision with lasting consequences or rejected alternatives | ADR |
| Change too big for a backlog row | spec folder ([sdd.md](sdd.md)) |
| New package | `README.md`, `AGENTS.md`, row in architecture package map, dependency rule |
| New public API | TSDoc, API report, changeset, SDK guide page if plugin-facing |
| Schema / DSL / CLI / MCP change | reference page + "Upgrading" note ([contracts.md](contracts.md)) |
| Finding that corrects an earlier belief | commit body + fix the doc that held the belief |
| Process change | edit the standard (reviewed like code) and re-run `build-index.mjs` |
