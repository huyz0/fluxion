# CI/CD

> Read when: editing anything under `.github/`, adding a gate or a test tier to CI, changing
> caching or sharding, preparing a release, or wondering why `ci-ok` is red.
> Family: Delivery · Related: [testing.md](testing.md), [git.md](git.md), [security.md](security.md)

CI is the only gate an agent cannot skip. It runs **the same scripts** as the local hooks, plus
the slow tiers that do not fit the 360 s pre-commit budget (ADR-0158). One gate, one definition: a check
that exists only in YAML is a bug.

## 1. Gate ladder

| Rung | Where | Command | Budget |
|---|---|---|---|
| quick | PostToolUse hook, on demand | `pnpm verify:fast` = `precommit.mjs --quick` (incremental `tsc -b`, `biome ci .`, `vitest run --changed`, harness checks) | < 30 s |
| pre-commit | `.githooks/pre-commit` | `node scripts/gates/precommit.mjs --staged` (runs what the staged paths can affect: `ladder-scope.mjs`; the rest runs in CI) | ≤ 360 s (`check-budget.mjs`, ADR-0158) |
| milestone | drive loop | `node scripts/gates/m<n>-complete.mjs` | per milestone |
| CI | PR, merge queue, push to `main` | `pnpm verify` (= `precommit.mjs --all`) + E2E, visual, a11y, size, API, license, security | ≤ 15 min wall |
| nightly | cron | mutation, long property runs, perf benchmarks, live AI eval, cross-OS visual | ≤ 90 min |

## 2. Rules

| # | Rule | Enforced by |
|---|---|---|
| 1 | Workflow steps call `pnpm` scripts or `node scripts/…`, never inline logic longer than one line. Anything a job checks must also be runnable locally. | `check-portability.mjs` (scans workflows for inline scripts) |
| 2 | **One required check: `ci-ok`**, an aggregate job that `needs:` every CI job and fails if any failed or was cancelled. Adding a job never touches branch protection. | GitHub ruleset |
| 3 | Triggers: `pull_request`, `merge_group`, `push: main`. No gate may run *only* on PRs; the merge queue runs the same set. | `check-drift.mjs` (trigger lists) |
| 4 | Every third-party action is **pinned by full commit SHA** with a `# vX.Y.Z` comment; Renovate updates them. | `zizmor` in `security.yml` |
| 5 | Top-level `permissions: contents: read`. Jobs widen only what they need; only `release.yml`'s publish job gets `id-token: write`. | `zizmor` |
| 6 | `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: ${{ github.event_name == 'pull_request' }} }`. Never cancel `main` or release runs. | review |
| 7 | No retries for unit/component tests. Playwright may retry once **only to detect** flakes: a test that passed on retry fails the `flake-report` step (see [testing.md](testing.md) §8). | `playwright.config.ts` + `scripts/ci/flake-report.mjs` |
| 8 | Caches are keyed on lockfile hash and tool version; a cache miss must only cost time, never change results. | review |
| 9 | Secrets never reach PR jobs from forks. `pull_request_target` is banned. | `zizmor` |
| 10 | Node version comes from `.node-version` (22 LTS); the ladder (`pnpm verify`) runs once per OS on ubuntu/windows/macos in `ci.yml`'s verify matrix, and `gates.yml` only adds the ubuntu-only harness gates (workflow lint, `check-commits.mjs`) (NFR-PORT-005). | `ci.yml`, `ci-workflow.test.mjs` |
| 11 | CI never pushes commits, tags, or publishes except `release.yml` on an explicit human-merged Version PR. | review |

## 3. Workflows (sketch)

### `ci.yml`

```yaml
on: { pull_request: {}, merge_group: {}, push: { branches: [main] } }
permissions: { contents: read }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: ${{ github.event_name == 'pull_request' }} }

jobs:
  verify:            # matrix os: [ubuntu, windows, macos]
    steps: [checkout@<sha>, pnpm/action-setup@<sha>, setup-node@<sha> (cache: pnpm),
            turbo cache restore, pnpm install --frozen-lockfile, pnpm verify]
  cold-setup:        # ubuntu; no cache; check-budget --cold: fresh clone, empty store, pnpm i + run setup
                     # + verify within COLD_SETUP_MAX_MS (NFR-DX-001); in CI it, not the committed
                     # budget.json, answers for a changed lockfile (ADR-0143)
  build:             # turbo run build --affected; uploads dist/ artifact
  e2e:               # needs build; matrix browser: [chromium, firefox, webkit] × shard: [1/4..4/4]
    container: mcr.microsoft.com/playwright:v1.62.0-noble
    steps: [... , pnpm test:e2e --project=$browser --shard=$shard, upload blob-report]
  e2e-report:        # needs e2e; playwright merge-reports; flake-report
  visual:            # needs build; pinned Playwright image; pnpm test:visual; uploads diffs on failure
  a11y:              # needs build; pnpm test:a11y (axe, 0 serious/critical)
  size:              # needs build; size-limit (NFR-SIZE-001/002/003)
  api:               # api-extractor run (reports must match packages/*/api/*.api.md); changeset present
  license:           # license check against allowlist (NFR-LIC-002)
  eval-recorded:     # pnpm eval --recorded (T5 on recorded responses)
  ci-ok:
    if: always()
    needs: [verify, cold-setup, build, e2e-report, visual, a11y, size, api, license, eval-recorded]
    steps: [node scripts/ci/all-green.mjs '${{ toJSON(needs) }}']
```

### `security.yml`

PR + weekly cron: CodeQL (javascript-typescript), OSV-Scanner on `pnpm-lock.yaml`,
`actions/dependency-review-action` (fails on new high/critical or disallowed license), `zizmor`
on `.github/`. Secret scanning + push protection are repo settings. Results feed `ci-ok` via a
reusable call from `ci.yml`.

### `nightly.yml`

```yaml
on: { schedule: [{ cron: '17 2 * * *' }], workflow_dispatch: {} }
jobs:
  mutation:     # pnpm mutate --check (tzap, ADR-0146) on pure packages; floors in .harness/baselines/mutation.json
  properties:   # FC_NUM_RUNS=10000 pnpm test:props
  perf:         # pnpm bench; compare to baseline ±15 % (NFR-PERF-005); upload trend
  eval-live:    # pnpm eval --live (needs AI key secret; environment: nightly)
  visual-xos:   # visual suite on ubuntu/windows/macos Chromium (NFR-PORT-006)
  report:       # on failure: node scripts/ci/nightly-issue.mjs → opens/updates one issue
```

Nightly failures do not block PRs; they create an issue that the next milestone plan must
dispose of (fix row, or recorded deferral).

### `preview.yml`

PR only (same-repo branches): build `apps/studio`, `apps/docs`, and Storybook; deploy each to a
Cloudflare Workers static-assets preview named `pr-<number>`; post or update one sticky comment
with the URLs. Uses a scoped Cloudflare token in the `preview` environment. Previews carry
`X-Robots-Tag: noindex`.

### `release.yml`

```yaml
on: { push: { branches: [main] } }
concurrency: { group: release, cancel-in-progress: false }
jobs:
  release:
    permissions: { contents: write, pull-requests: write, id-token: write }
    environment: npm            # required reviewer = a human
    steps: [..., changesets/action@<sha> with publish: pnpm release]
```

- Without pending changesets it does nothing. With them it opens/updates the "Version Packages"
  PR. Merging that PR (a human action) publishes.
- Publishing uses **npm trusted publishing (OIDC)**; provenance is automatic. No `NPM_TOKEN`.
- Agents prepare releases only through the `ship` skill and only when a human asks.

## 4. Caching and speed

| What | How |
|---|---|
| pnpm store | `setup-node` `cache: pnpm` keyed on `pnpm-lock.yaml` |
| Turborepo | remote cache (`TURBO_TOKEN`/`TURBO_TEAM` secrets); PRs use `--affected` |
| tsc / Biome | incremental `.tsbuildinfo` restored from cache |
| Playwright browsers | run inside the pinned image instead of downloading |
| E2E sharding | 4 shards per browser; blob reports merged in `e2e-report`; raise shard count when a shard exceeds 6 min |

## 5. Changing CI

- A new gate lands in `scripts/gates/` first, is wired into `precommit.mjs` or a named CI job,
  and gets a negative test in `tests/harness/` proving it fails on bad input (run by precommit and CI).
- Removing or loosening a CI job is a threshold change: `Threshold-change:` trailer + ADR.
- If the pre-commit budget is exceeded, move the slowest leg to CI rather than raising the
  budget without an ADR.
