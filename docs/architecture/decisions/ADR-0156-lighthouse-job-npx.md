---
status: accepted
date: 2026-10-05
decision-makers: harness (M11.19; within NFR-SIZE-002 and security.md rules 19 and 20; no runtime dependency; an exception to be closed by M11.54)
---

# ADR-0156 — The Lighthouse CI job fetches `@lhci/cli` with npx, exactly pinned, until a lockfile change can be recorded

## Context and Problem Statement

NFR-SIZE-002 asks for the editor's time to interactive on a reference desktop, measured by Lighthouse in CI (M11.19). `@lhci/cli` brings Lighthouse, a Chromium
driver and a web server. The repository's own supply-chain rules (security.md 19 and 20) lock every dependency in `pnpm-lock.yaml` and hold new releases back
(`minimumReleaseAge`). A devDependency would do that, but a commit that changes `pnpm-lock.yaml` must carry a `check-budget --record` measured on the worst-case
staged commit, and the machine this was written on takes 315 s for that against the 120 s budget (M11.52 waits on the same thing).

## Decision Outcome

The `lighthouse` job in `ci.yml` runs `npx --yes @lhci/cli@0.14.0 autorun` with the top-level package pinned to an exact version, as a temporary exception:

- The job has the workflow's read-only token (`contents: read`), `persist-credentials: false`, and no secrets; it only reads the studio's `dist` and serves it on localhost.
- It is not on the release path: nothing it produces is published, and a bad run turns only `lighthouse` (and so `ci-ok`) red.
- The transitive tree is not locked: this is the exception. **M11.54** adds `@lhci/cli` as a devDependency (locked, licence-checked, release-age rules) and runs `pnpm exec lhci`,
  in the same commit as M11.52, from a machine whose staged ladder fits the budget.

## Consequences

- Good: the Lighthouse result is CI evidence now (`check-ci-evidence.mjs` requires the job), measured against `EDITOR_TTI_MS` from `thresholds.mjs`.
- Bad: until M11.54, a compromised transitive release of `@lhci/cli` would run in a read-only, secret-free CI job. The exception ends there.

## Update

The exception is closed by M11.54 (2026-10-06): `@lhci/cli` 0.14.0 is a locked devDependency, and the job runs `pnpm exec lhci autorun`.
