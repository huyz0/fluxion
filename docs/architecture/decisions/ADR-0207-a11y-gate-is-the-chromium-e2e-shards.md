---
status: accepted
date: 2026-10-29
decision-makers: Huy (decision card, 2026-10-29); harness (M18.184, subject to independent review)
---

# ADR-0207 — The a11y gate is the chromium e2e shards

## Context and Problem Statement

ci.yml's `a11y` job ran `pnpm test:a11y`, which is `playwright test --project=chromium
--grep-invert @no-a11y`: the whole chromium desktop project a second time, in the same pinned
Playwright image, against the same `dist` artifact. axe does not run because of that job. It runs
inside each spec that calls the `expectAccessible` fixture of `e2e/test.ts`, and those specs also
run in the chromium e2e shards (`pnpm test:e2e --project=chromium`, whose only filter is
`--grep-invert @perf`, which the chromium project already drops). So every axe assertion was made
twice per ci run.

Over 60 main runs to 2026-10-29 the job took 6.8 minutes median and waited 37 minutes median for
a runner. The account runs 20 jobs at once and a ci run asks for 36, so a duplicate job costs
queue time for every other job.

## Decision Drivers

- Never weaken a gate: the same specs and the same axe assertions (0 serious or critical
  violations, NFR-A11Y-001) must still run, and fail ci-ok, on every commit.
- Fewer runner slots per ci run, so the jobs that remain start sooner.

## Considered Options

1. **Keep the job.** Costs one runner and about 7 runner-minutes a run for no extra assertion.
2. **Keep the job but run only the specs that call `expectAccessible`.** Still a duplicate of the
   shards, and a second list of specs to keep in step.
3. **Remove the job; the chromium e2e shards are the a11y gate.** Chosen.

## Decision Outcome

ci.yml has no `a11y` job and ci-ok does not need one. The chromium e2e shards run every chromium
spec, so every `expectAccessible` call runs once per commit and fails ci-ok through `e2e` and
`e2e-report`. `pnpm test:a11y` stays as a local command. m1-complete's job-set leg no longer asks for
an `a11y` job and asks instead that e2e runs chromium. A harness test
(`tests/harness/ci-workflow.test.mjs`) proves that the shards' command and the chromium project's
filters cover every spec the job ran.

### Consequences

- Good: one fewer job per ci run (about 7 runner-minutes and one queue slot).
- Bad: a failed axe check is reported under `e2e (chromium n/4)` rather than `a11y`; the failing
  spec and its axe message are the same.
- If an a11y-only project is ever added (another browser, a different viewport), it needs its own
  job or shard again.
