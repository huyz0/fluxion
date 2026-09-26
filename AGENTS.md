# Fluxion

TypeScript platform to author, AI-generate and present **interactive, animated diagram-screens**
(full-screen decks, mobile views, static info sites) saved as **one portable file**.
Built almost entirely by AI agents (Claude Code, Codex) through the harness described here.

This file is loaded by every agent tool in every session. It is an **index**: detail lives in
linked files, loaded only when a skill or task says so. Keep it ≤ 250 lines (`check-size`).

## Start here

| Read | When |
|---|---|
| [docs/research/](docs/research/) | Background & options (upstream of everything; don't re-research what's there) |
| [docs/requirements/](docs/requirements/README.md) | What to build — FR/NFR IDs cited by tasks and tests |
| [docs/architecture/](docs/architecture/README.md) | How it is built — packages, layering, contracts, ADRs |
| [docs/standards/](docs/standards/README.md) | Rules that are always true — read the one covering what you touch |
| [docs/milestones/roadmap.md](docs/milestones/roadmap.md) | Milestones in order, **current milestone**, completion commands |
| [docs/backlog/current.md](docs/backlog/current.md) | Current milestone's tasks — authoritative |
| [.harness/](.harness/README.md) | Loop state: `state.json`, `progress.md`, review verdicts |

## Skills

Procedures in [.agents/skills/](.agents/skills/README.md) (Agent Skills spec; Codex reads them
natively, Claude via generated adapters in `.claude/skills/`). Invoke as `/name` (Claude) or
`$name` (Codex).

<!-- index:skills:start -->
| Skill | Use when |
|---|---|
| [`drive`](.agents/skills/drive/SKILL.md) | Driving the current milestone to completion autonomously (usually under `/goal`) |
| [`next-task`](.agents/skills/next-task/SKILL.md) | Starting a session or finishing a task and needing the next ready task |
| [`plan-milestone`](.agents/skills/plan-milestone/SKILL.md) | A milestone has no backlog rows yet or its completion gate does not exist |
| [`spec`](.agents/skills/spec/SKILL.md) | A task or feature needs acceptance criteria or a design before code |
| [`tdd`](.agents/skills/tdd/SKILL.md) | Implementing any task (test first) |
| [`ui-check`](.agents/skills/ui-check/SKILL.md) | A task changes something visible or interactive in studio/player |
| [`verify`](.agents/skills/verify/SKILL.md) | Before review/commit, or whenever you need to prove the tree is green |
| [`code-review`](.agents/skills/code-review/SKILL.md) | A change is staged and needs an independent review verdict |
| [`milestone-review`](.agents/skills/milestone-review/SKILL.md) | Every ~8 commits and before declaring a milestone complete |
| [`adr`](.agents/skills/adr/SKILL.md) | Making a choice that is expensive to reverse, or changing a contract |
| [`research`](.agents/skills/research/SKILL.md) | A question may already be answered in docs/research |
| [`ship`](.agents/skills/ship/SKILL.md) | A human asked to release, publish or open a PR |
| [`brevity`](.agents/skills/brevity/SKILL.md) | Writing reports, progress entries or review findings |
<!-- index:skills:end -->

## Commands

```
node scripts/harness/setup.mjs             one-time: git hooks path, skill adapters
pnpm verify:fast                           quick gate (changed files)          [from M1]
pnpm verify                                full gate == CI pre-commit ladder   [from M1]
node scripts/gates/precommit.mjs           pre-commit ladder (hook runs it with --staged)
node scripts/gates/m<N>-complete.mjs       completion gate of milestone N
node scripts/harness/review.mjs context --task M3.4     reviewer packet
node scripts/harness/run-reviewer.mjs --task M3.4       run independent reviewer (other vendor)
node scripts/harness/review.mjs record --file v.json    store verdict (bound to staged diff hash)
node scripts/harness/sync-skills.mjs [--check]          regenerate/check .claude/skills adapters
```

## Non-negotiables

Each names its gate. A rule whose gate script does not exist yet is a **preference** until
the milestone that writes it — say so rather than claiming enforcement.

1. **One task = one commit = green tree.** Subject `<TaskID>: <type>(<scope>): <summary>`.
   → `check-commit-msg.mjs`, `precommit.mjs`
2. **Never weaken a gate to pass it**: no deleting/skipping tests (unless trailer
   `Removes-test:` with reason), no loosening thresholds in `scripts/gates/thresholds.mjs`,
   no updating visual baselines without `Threshold-change:` trailer.
   → `check-tests-kept.mjs`, `check-drift.mjs`
3. **Never claim a check passed without running it and showing its output.** No gate can
   enforce this; everything else rests on it.
4. **Every commit is reviewed by an agent that did not write it**, given task + diff, never the
   author's reasoning; verdict bound to the staged-diff hash. → `check-reviewed.mjs`
5. **Pure core**: `schema, geometry, core, theme, layout, routing, anim, format, dsl` never touch
   DOM, timers, clock, randomness, network or `node:*` — inject ports. → `check-layering.mjs`
6. **Contracts change deliberately**: file format/schema, public SDK API, FluxScript grammar,
   CLI `--json`, MCP tool schemas change only with an ADR + migration/fixtures + tests in the
   same commit. → `check-api.mjs`, format fixture tests
7. **Requirements are traced**: tests name the FR/NFR IDs they verify; tasks cite IDs.
   → `check-trace.mjs`
8. **No new runtime dependency** without license check and a reason in the commit body
   (player deps need an ADR). → `check-licenses.mjs`

## Never

- Never push, force-push, publish, deploy or open PRs unless a human asked (skill `ship`).
- Never use `--no-verify` or disable hooks.
- Never widen scope silently — out-of-scope work becomes a backlog row.
- Never edit `docs/requirements/` without an ADR or spec change (skill `spec`).
- Never run two agent sessions in the same worktree (`git worktree add ../fluxion-<slug>`).
- Never store secrets/API keys in the repo, fixtures, logs or documents.

## Stop and hand back to the human when

A gate still fails after 3 genuine fix attempts · a decision is needed (ambiguous requirement,
conflicting standards) · the spec is wrong and fixing it changes scope · the top 3 tasks are
blocked · the completion gate passes but the milestone is clearly not done · the next step is
destructive or outward-facing. Record the reason in `.harness/state.json` → `blockedReason`.

## Package map (details: docs/architecture/01-overview.md)

`packages/`: schema · geometry · core · theme · layout · routing · anim · format · dsl ·
render · player · editor · sdk · cli · mcp · exporters — `apps/`: studio · docs —
`packs/`: first-party plugins. Each package has its own `AGENTS.md` with local context.
