---
status: accepted
date: 2026-09-28
decision-makers: harness (M2 delta review D1/D3, row M3.5; within NFR-DX-001, NFR-PORT-005; extends ADR-0143)
---

# ADR-0145 — A lockfile commit records a pending cold setup; CI's measurement replaces it after the push

## Context and Problem Statement

ADR-0143 made the CI `cold-setup` job the cold-setup authority inside CI, while a local full ladder
and the completion gates still need `.harness/budget.json` to describe the current
`pnpm-lock.yaml`. Two gaps remained (M2 delta review D1, D3):

- The staged pre-commit ladder never ran the budget step, so a commit could change the lockfile
  and leave the record stale for whoever ran `pnpm verify` next.
- `check-budget --record` measures the cold setup locally, which downloads Chromium. Agent
  containers that cannot reach `cdn.playwright.dev` could not refresh the record at all, so any
  dependency change blocked a milestone on a human (it did in M2).

Also open: whether Windows and macOS need their own cold-setup measurement.

## Decision Drivers

- NFR-DX-001: cold setup of the current dependency set is measured, under 10 min, on record.
- Agents must be able to finish a dependency change without a human.
- NFR-PORT-005 without tripling CI minutes (macOS minutes cost 10× ubuntu's).

## Considered Options

1. **Pending record in the lockfile commit, CI number after the push.** The staged ladder runs the
   budget step when `pnpm-lock.yaml` is staged. `check-budget --record --cold-pending` measures the
   quick and staged ladders and carries the previous cold-setup number, marked
   `coldSetupSource: "pending-ci"`. After the push, `check-budget --record --cold-from-ci <sha>`
   takes the duration of the `cold setup within COLD_SETUP_MAX_MS` step of that commit's green
   `ci` run (its lockfile must equal the recorded one) and records `coldSetupSource: "ci:<run id>"`.
2. Local cold setup reusing the machine's browser cache (not cold; hides download time).
3. Keep the human re-record (M2's blocker stays).

## Decision Outcome

Chosen option 1.

- The staged budget step (`check-budget --staged`) accepts a `pending-ci` record; CI accepts it
  too (its cold-setup job measures the commit). A local full ladder (`pnpm verify`) and the
  completion gates (`verifyLeg`, CI unset) reject it and print the `--cold-from-ci` command, so a
  milestone cannot close on a carried number.
- A local measurement (`--record`, `coldSetupSource: "local"`) stays valid everywhere.
- **Windows and macOS get no cold-setup job.** The ubuntu job is the NFR-DX-001 reference
  measurement; the verify matrix on all three OSes already installs and runs the full ladder on
  every push (its own job timeouts bound it), and a local `--record` on Windows or macOS remains
  available when a platform-specific install regression is suspected.

### Consequences

- Good: an agent without Chromium access can change dependencies: pending record, push, CI
  number, done — no human step.
- Good: a stale or carried number cannot close a milestone.
- Bad: between the lockfile commit and the `--cold-from-ci` commit, a local `pnpm verify` is red
  at the budget step by design.
- Bad: a slow Windows- or macOS-only install is caught by those verify jobs' timeouts rather than by
  a dedicated measurement.

### Confirmation

`tests/harness/budget.test.mjs`: "cold setup recorded from a CI run", "pending cold setup",
"staged lockfile runs the budget step"; the M3 completion gate runs the first and last by name.

## Pros and Cons of the Options

### Pending record + CI number

- Good: agent-runnable, honest at milestone boundaries. Bad: one extra bookkeeping commit per
  dependency change.

### Browser-cache reuse

- Good: one local command. Bad: not a cold setup; Chromium download time is the dominant cost.

### Human re-record

- Good: nothing to build. Bad: blocks agents on every dependency change.

## More Information

ADR-0143 (CI authority); M2 delta review D1/D3 (`.harness/reviews/milestone-M2-final.json`);
`scripts/gates/check-budget.mjs`; `.github/workflows/ci.yml` `cold-setup` job.
