---
name: spec
description: Write acceptance criteria and, when needed, a short spec (proposal/design/tasks) before implementing. Use when a task lacks checkable acceptance criteria, when a feature spans several rows, when a requirement must change, or when what to build is clearer than how it will be checked.
---

# Spec

Standard: `docs/standards/sdd.md`. Keep it short; a spec is a tool for being checkable.

## Decide the size

| Situation | Artifact |
|---|---|
| One row, clear behaviour | EARS criteria in the backlog row only |
| Several rows or a design choice | `specs/<ID>-<slug>/` with `proposal.md`, `design.md`, `tasks.md` |
| Requirement added/changed/removed | spec folder **+** edit `docs/requirements/*` and `40-traceability.md` in the same commit, plus [`adr`](../adr/SKILL.md) if scope/approach changes |

## Acceptance criteria (EARS)

- Ubiquitous: `THE SYSTEM SHALL …`
- Event: `WHEN <trigger> THE SYSTEM SHALL …`
- State: `WHILE <state> THE SYSTEM SHALL …`
- Unwanted: `IF <condition> THEN THE SYSTEM SHALL …`

Each criterion must be checkable by a test, a gate, or a number within a bound.

- ❌ "Routing works well"
- ✅ "WHEN two shapes are separated by a third THE SYSTEM SHALL route the orthogonal connector
  with no segment intersecting the third shape's bounds + 8 px margin"

If you cannot write a checkable criterion, you do not understand the task yet — research
(`research` skill) or stop and ask.

## Spec folder contents

- `proposal.md` — why, requirement IDs, scope / non-scope.
- `design.md` — approach, alternatives rejected (one line each), contracts touched, risks.
- `tasks.md` — rows to paste into the backlog (same row format as `plan-milestone`).

## When the spec turns out wrong

Stop, amend the spec (and requirement docs if needed) in its own commit, note it in
`.harness/progress.md`. If it changes scope or an approach, that is a decision → `adr` or a
human (drive stop condition). Never implement "something adjacent" silently.

## Review

A spec folder is reviewed before its first code row, using `code-review --kind plan`.
