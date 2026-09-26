---
status: accepted (review-vendor clause and dry-run confirmation superseded by ADR-0137)
date: 2026-09-26
decision-makers: Fluxion maintainers
---

# ADR-0009 — AI harness: AGENTS.md, portable skills, goal-driven milestone loop, hash-bound cross-vendor review

## Context and Problem Statement

Fluxion is built mostly by AI agents (Claude Code and OpenAI Codex) with minimal human involvement.
Both tools must follow the same procedures (NFR-DX-003). Work must advance milestone by milestone
without an agent declaring success on its own judgement, and every commit must be independently
reviewed. How do we structure instructions, procedures, loop control and review?

## Decision Drivers

- One source of truth for instructions, readable by both vendors.
- Deterministic exit criteria: "done" is an exit code, not an opinion.
- Independent review, with blind spots decorrelated.
- No collisions with built-in slash commands (`/goal`, `/review`, `/plan`).
- Proven in practice: the user's `oqueue` repo (`E:\work\oqueue`) ran ~580 agent-written commits
  with this pattern.

## Considered Options

1. Separate vendor-specific instruction trees (`CLAUDE.md` + `.claude/`, `AGENTS.md` + `.codex/`)
2. A spec-driven framework as-is (OpenSpec, Spec Kit, BMAD)
3. Ralph/Wiggum-style infinite loop with prompt-only stop conditions
4. oqueue-style harness: AGENTS.md + canonical portable skills + built-in `/goal` over a
   `drive` skill + milestone completion gates + hash-bound cross-vendor review

## Decision Outcome

Chosen option: **4**.
- `AGENTS.md` is the source of truth (≤ ~250 lines). `CLAUDE.md` contains only `@AGENTS.md`.
- Canonical skills live in `.agents/skills/<name>/SKILL.md` (Agent Skills spec). Thin adapters in
  `.claude/skills/` are **generated** by `scripts/harness/sync-skills.mjs` and checked for drift.
- The built-in `/goal` of either tool drives the `drive` skill (deliberately not named `goal`).
  The loop: next-task → TDD → gates → review → commit → tick backlog.
- Each milestone has a **completion gate script** `scripts/gates/m<n>-complete.mjs`, written
  **first and red**. The goal is met only when it exits 0 with its output printed.
- Every commit needs a review verdict bound to the **sha256 of the staged diff**, produced by the
  *other* vendor's CLI from a packet without author reasoning. **Superseded by ADR-0137:** the
  default reviewer is an isolated subagent; cross-vendor review is optional. `check-reviewed.mjs` enforces it
  in pre-commit.
- State lives in files: roadmap, backlog, `.harness/progress.md` and `.harness/state.json`.

### Consequences

- Good, because both tools share procedures and gates; switching vendors is a config choice.
- Good, because loop termination and review are machine-checked, not self-reported.
- Good, because cross-vendor review is cheap when both CLIs are available.
- Bad, because review doubles token cost per commit (a risk-based bypass is deferred until measured).
- Bad, because the harness itself is code to maintain (gates, sync script, negative gate tests).

### Confirmation

`check-portability` (no vendor syntax in canonical skills, adapters in sync, no name collisions).
A negative test suite proves each gate fails on a broken fixture. Dry runs of `/goal` on a trivial
milestone in both tools must stop correctly on success and on an impossible condition.
**Superseded by ADR-0137:** dry runs are optional; confirmation is check-portability, adapter
tests, the negative gate suite and the M0.13 cross-vendor smoke.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| Vendor-specific trees | native features | duplicated instructions drift; violates NFR-DX-003 |
| Spec framework as-is | ready-made | heavyweight ceremony; not gate-driven; vendor assumptions |
| Ralph loop | minimal | no deterministic exit; drifts; no review |
| oqueue-style harness | proven, deterministic, portable | harness maintenance, review cost |

## More Information

Research: `docs/research/06-ai-harness-research.md` §1 (oqueue), §2 (goal loops), §3 (portable
skills), §6 (proposed harness). Reference implementation: `E:\work\oqueue` (`AGENTS.md`,
`.agents/skills/`, `scripts/`). Standards: `../../standards/git.md`, `../../standards/ci-cd.md`.
