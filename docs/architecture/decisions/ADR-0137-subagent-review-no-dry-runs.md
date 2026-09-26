---
status: accepted
date: 2026-09-26
decision-makers: project owner (human decision), recorded by the harness
supersedes: ADR-0009 (review-vendor clause and dry-run confirmation only)
---

# ADR-0137 — Isolated-subagent review by default; `/goal` dry runs not required

(Numbered after the range 0011–0136 that milestone plans reserve for their planned decisions.)

## Context and Problem Statement

ADR-0009 made every per-commit verdict come from the *other* vendor's CLI and required `/goal`
dry runs in both Claude Code and Codex as its confirmation. During M0 the Claude CLI was not
logged in on the build machine, and a headless `codex exec` does not run the built-in goal loop,
so neither the cross-vendor default nor the dry runs could be satisfied by the agent. The project
owner decided on 2026-09-26: *"don't worry about interactive shell or codex, use subagent only for
review."*

## Decision

1. **Reviewer:** every per-commit and milestone review is done by an **isolated reviewer
   subagent** of the authoring tool (Claude: `.claude/agents/reviewer.md` /
   `milestone-reviewer.md`; Codex: a fresh subagent), given only the packet — never the author's
   reasoning. The verdict stays bound to the staged-diff hash (`check-reviewed.mjs`, unchanged).
   Cross-vendor CLI review (`run-reviewer.mjs`) remains available **on human request**.
2. **Confirmation of ADR-0009:** `/goal` dry runs in interactive sessions are **not** required.
   The harness is confirmed by `check-portability`, the adapter tests
   (`tests/harness/adapters.test.mjs`), the negative gate suite, and the M0.13 cross-vendor smoke
   (2/2 seeded defects caught). The dry-run kit stays available (roadmap "Deferred").
3. **NFR-DX-003** is verified by `check-portability` + adapter tests + harness test suite; the
   dry-run record becomes optional evidence.

All other parts of ADR-0009 remain in force.

## Consequences

- Good: reviews never stall on an unavailable or logged-out CLI; the loop can run unattended.
- Good: review cost stays within one vendor's budget.
- Bad: same-vendor reviewers share blind spots with the author; mitigated by fresh context, the
  packet excluding author reasoning, the adversarial reviewer prompt, and milestone reviews.
- Bad: the built-in `/goal` loop's stop behaviour is unobserved in a controlled trial; mitigated by
  the optional deterministic Stop hook (`scripts/harness/stop-check.mjs`) and its tests.

## Confirmation

`docs/standards/review.md` §2 and the `code-review` / `milestone-review` skills name the subagent
as default (task M0.26); `m0-complete.mjs` has no dry-run leg; the backlog rows M0.14/M0.15 are
`descoped (...)` with the reason, and the roadmap "Deferred" table lists the dry runs.
