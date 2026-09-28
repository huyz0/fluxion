---
status: accepted
date: 2026-09-28
decision-makers: human (repo owner, 2026-09-28; M2 final review F1, row M2.27)
---

# ADR-0143 — Inside CI the cold-setup job is the cold-setup authority; locally the recorded budget is

## Context and Problem Statement

Two checks cover the cold-setup budget (NFR-DX-001, `COLD_SETUP_MAX_MS`):

- `check-budget.mjs` (the `budget` step of `pnpm verify`, M1.19) reads `.harness/budget.json`
  and fails when the record predates `pnpm-lock.yaml`, so a heavier install cannot pass on an old
  number.
- `check-budget.mjs --cold` (the `cold-setup` job of ci.yml, M2.21, needed by `ci-ok`) measures a
  cold setup of the commit under test on a fresh runner every run, and writes nothing.

ci.yml's verify matrix runs `pnpm verify` on three OSes, so after any lockfile change (a Renovate
PR, a dependency row) verify is red everywhere until someone re-records the budget on a machine
that can download Chromium, even though the same run's `cold-setup` job measured the new lockfile
under budget. The M2 final review (F1) found that no agent-runnable path turns it green.

## Decision Drivers

- NFR-DX-001: the cold setup of the current dependency set stays under 10 min and is measured,
  not assumed.
- Gate honesty: a check must not be red when its question was answered in the same run.
- Dependency updates arrive as CI-only PRs (Renovate) that never run a local `--record`.

## Considered Options

1. **In CI, the budget step accepts a record older than the lockfile** (with a note); the
   `cold-setup` job measures the lockfile live. Locally (the full ladder and the completion
   gates, not the staged pre-commit hook) a stale record still fails.
2. Always require a fresh record: every lockfile change commits a re-recorded `budget.json`.
3. The `cold-setup` job uploads its measurement and the verify matrix waits for and reads it.

## Decision Outcome

Chosen option 1 (human decision, 2026-09-28). When `CI` is `true` or `1`, `check-budget.mjs`
prints `the record predates pnpm-lock.yaml; in CI the cold-setup job measures this lockfile
(ADR-0143)` instead of failing. Every other check is unchanged: the recorded quick, staged and
cold-setup numbers must still be within their thresholds, and a missing record still fails.

### Consequences

- Good: a lockfile-only change is judged by a live cold-setup measurement in the same run; verify
  stays green on three OSes.
- Good: the local rule (M1.19 review F2) is intact in the full ladder: local `pnpm verify` and
  the completion gates' verify leg (`verifyLeg` in `milestone-checks.mjs`, used from m3-complete on;
  it runs with `CI` unset) fail on a stale record. m1- and m2-complete predate it: m2-complete
  unsets `CI` itself, m1-complete (closed) does not.
- Bad: the staged pre-commit hook does not run the budget step (it runs only in `--all`), so no
  gate forces a re-record in the commit that changes the lockfile; the stale record surfaces at
  the next local `pnpm verify` or completion gate. Re-recording needs a machine that can download
  Chromium, which agent containers may not reach (handed to M3; M2 delta review D1).
- Bad: a lockfile change merged from CI alone (Renovate) likewise leaves a stale record on main.
  That is a pending local re-measure, not a false green, because CI measured that lockfile.
- Bad: the cold-setup job runs on ubuntu only, so under this rule a lockfile change is not
  measured on Windows or macOS until the next local record there (handed to M3; delta review D3).
- Bad: the `CI` variable changes a gate's outcome; the harness test pins it both ways and the
  shared completion-gate verify leg unsets it (`verify-leg.test.mjs`).

### Confirmation

`tests/harness/budget.test.mjs`: "lockfile change in CI: a stale record passes with a note,
limits still apply" (CI=true passes, a threshold breach still fails, CI=false fails); "fails when
the record predates the lockfile" runs with CI unset.

## Pros and Cons of the Options

### CI accepts a stale record; the cold-setup job measures

- Good: no human step per dependency bump; the measurement is of the exact commit.
- Bad: a gate reads an environment variable.

### Always re-record

- Good: one rule everywhere.
- Bad: every Renovate PR is red until a human re-records on a machine that can download Chromium.

### CI writes the record for verify

- Good: verify checks the exact number measured.
- Bad: verify would depend on and wait for cold-setup (about 10 extra minutes on the critical
  path), plus artifact plumbing across jobs.

## Amendments

- 2026-09-28 (M2.29, M2 delta review D1): Consequences corrected — the staged pre-commit hook does
  not run the budget step (it runs only in `--all`), so a stale record surfaces at the next full
  verify or completion gate; the cold-setup job measures ubuntu only.
- 2026-09-28 (M3.4, M2.29 review F1/F2, delta E1–E3): Considered Options 1 no longer says the
  pre-commit hook fails a stale record; Consequences name the shared completion-gate verify leg
  (`verifyLeg`, m3-complete on) instead of "every completion gate". The decision is unchanged.

## More Information

M2 final review F1 (`.harness/reviews/milestone-M2-final.json`); M1.19 (budget record), M2.21
(cold-setup job); `docs/standards/ci-cd.md` §1.
