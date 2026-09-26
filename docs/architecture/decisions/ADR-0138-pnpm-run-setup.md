---
status: accepted
date: 2026-09-26
decision-makers: harness (naming fix within NFR-DX-001's intent)
---

# ADR-0138 — Invoke the repository setup script as `pnpm run setup`

## Context and Problem Statement

NFR-DX-001, the M1 plan, git.md and the backlog say a fresh clone is prepared with
`pnpm i && pnpm setup && pnpm verify`. In pnpm, `pnpm setup` is a **built-in** command that
configures `PNPM_HOME` and the shell profile; it never runs the `setup` script in
`package.json`. A contributor following the docs would skip `scripts/harness/setup.mjs`, so
`core.hooksPath` is never set and no local gate runs.

## Decision

The repository script keeps the name `setup` and is always invoked as **`pnpm run setup`**.
NFR-DX-001's command becomes `pnpm i && pnpm run setup && pnpm verify`; docs, the M1 plan and
git.md say the same. The requirement's intent and threshold are unchanged.

## Consequences

- Good: the documented command does what it says on every platform.
- Neutral: one extra word in the quickstart.

## Confirmation

`m1-complete.mjs` checks the README quickstart for `pnpm run setup`; `workspace-shape.test.mjs`
checks the `setup` script points at `scripts/harness/setup.mjs`.
