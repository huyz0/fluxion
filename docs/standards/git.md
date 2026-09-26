# Git

> Read when: about to commit, naming a branch, opening or merging a PR, or tempted to amend,
> rebase, push or skip a hook.
> Family: Process · Related: [review.md](review.md), [sdd.md](sdd.md), [ci-cd.md](ci-cd.md)

Fluxion is written by agents, so history is the main record of *why* the code looks the way it
does, and `git bisect` + `git revert` are the main repair tools. Both only work if every commit
is one task, green, and honestly described. Each rule names the gate that enforces it, or says
`no gate — judgement`.

## 1. Commits

| # | Rule | Enforced by |
|---|---|---|
| 1 | **One task = one commit = green tree.** A task that cannot land green in one commit was decomposed wrongly; split the backlog row, not the commit. | `precommit.mjs` (green); `check-commit-msg.mjs` (one ID) |
| 2 | **Never mix a refactor with a behaviour change.** Rename/move first, change behaviour in the next task. | no gate — judgement (reviewer checks) |
| 3 | **Mechanical churn travels alone**: formatting sweeps, bulk renames, dependency bumps, regenerated baselines. | no gate — judgement |
| 4 | **Stage deliberately.** `git diff --cached` is exactly what is reviewed; the review verdict is bound to its SHA-256, so an extra file invalidates the verdict. | `check-reviewed.mjs` |
| 5 | **Never commit a known-broken tree**, "fixed in the next commit" included. | `precommit.mjs` |
| 6 | **Docs, tests, changesets, and the backlog `State → done` travel with the code** they describe. A commit cannot know its own hash, so the row's `Commit` cell is filled by the next task commit. | `check-drift.mjs` (docs claims), CI changeset check |

## 2. Message format

```
M3.4: feat(routing): route orthogonal connectors around obstacles

Sparse-grid A* with bend penalty; nudging is left to M3.5 because it
needs the channel model from M3.2's follow-up.
Rejected: visibility graph (O(n^2) edges at 500 shapes, see ADR-0005).
Not done: hop rendering at crossings (M3.6).
Minor (review): helper name `cost2` kept; renamed in M3.5.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

| # | Rule | Enforced by |
|---|---|---|
| 7 | Subject is `<TaskID>: <type>(<scope>): <imperative summary>`. | `check-commit-msg.mjs` |
| 8 | `TaskID` is `M<n>.<k>` and must exist in `docs/backlog/current.md` (or the archive for follow-up corrections). IDs are stable and never reused. | `check-commit-msg.mjs` |
| 9 | `type` is one of `feat fix refactor perf test docs build ci chore`. `scope` is a package folder name (`core`, `routing`, `studio`), `harness`, `gates`, or `docs`. | `check-commit-msg.mjs` |
| 10 | Summary is specific and imperative: `add`, `route`, `reject`, not `update stuff`/`wip`/`fixes`. Subject ≤ 72 chars. | `check-commit-msg.mjs` (denylist + length) |
| 11 | Body (optional, ≤ ~20 lines, wrapped at 72) says **why**, what was rejected, and what is **not** done. It never narrates the diff or restates the backlog row. | no gate — judgement |
| 12 | Minor review findings not fixed are listed in the body, one line each. | no gate — judgement ([review.md](review.md) R11) |
| 13 | Reference ADRs by number (`ADR-0005`) when implementing or amending a decision. | no gate — judgement |

### Trailers

| Trailer | When | Enforced by |
|---|---|---|
| `Co-Authored-By: <agent> <email>` | Every agent-authored commit | `check-commit-msg.mjs` |
| `Removes-test: <reason>` | A test file or `it(...)` case disappears, a case title is swapped out, or a case is disabled (`skip`, `only`, `todo`, `skipIf`, `runIf`) | `check-tests-kept.mjs` |
| `Threshold-change: <reason>` | A value in `scripts/gates/thresholds.mjs`, a coverage/mutation floor, a size-limit, or a visual/SVG baseline moves | `check-drift.mjs` |

A `Threshold-change` may only **strengthen** a limit (higher floor, lower budget) unless an ADR
in the same commit justifies loosening it. Updating a golden or screenshot baseline counts as a
threshold change: the reason line says which intended behaviour changed the output.

## 3. Branches and worktrees

| # | Rule | Enforced by |
|---|---|---|
| 14 | **Trunk-based.** `main` is protected: linear history, no direct pushes, required check `ci-ok`, merge queue. | GitHub ruleset |
| 15 | **One worktree per agent session**, on branch `agent/M<n>-<slug>` (e.g. `agent/M3-orthogonal-routing`). Two sessions never share an index. Create with `node scripts/harness/worktree.mjs add M3 orthogonal-routing`. | no gate — `worktree.mjs` convention |
| 16 | A branch lives for one milestone checkpoint: ~5–10 task commits, then a PR. Rebase onto `main` before opening it; never merge `main` into the branch. | `check-commit-msg.mjs` (rejects merge commits) |
| 17 | PRs are merged by **rebase** so per-task commits survive on `main`. No squash (it destroys the task↔commit map), no merge commits. | Repo setting (rebase only) |
| 18 | PR title: `M3 checkpoint: <what the commits deliver>`. Body lists task IDs, the milestone gate output, and links to milestone review verdicts. | no gate — judgement |

## 4. Hooks

| # | Rule | Enforced by |
|---|---|---|
| 19 | Hooks are tracked in `.githooks/` and installed by `pnpm run setup` (`git config core.hooksPath .githooks`; `pnpm setup` is a pnpm built-in, ADR-0138). Never rely on untracked `.git/hooks`. | `check-portability.mjs` verifies hooksPath |
| 20 | `pre-commit` runs `node scripts/gates/precommit.mjs --staged`; `commit-msg` runs `node scripts/gates/check-commit-msg.mjs`. | the hooks themselves |
| 21 | **Never `--no-verify`**, never `-c core.hooksPath=` tricks. If a hook is wrong, fix the hook in its own task. | CI re-runs everything (`ci-ok`) |

## 5. Rewriting, pushing, publishing

| # | Rule | Enforced by |
|---|---|---|
| 22 | Amend or non-interactive rebase freely on your own **unpushed** agent branch (e.g. to fold in a review fix). Any amend changes the staged diff, so re-record review. | `check-reviewed.mjs` |
| 23 | **Never push, force-push, open a PR, tag, or publish unless the human asked** in this session. | no gate — judgement (harness stop condition) |
| 24 | Never rewrite `main`. A wrong commit on `main` is fixed by `git revert` (subject `Revert "M3.4: …"`, exempt from rule 7) or a follow-up task with a new ID. | GitHub ruleset |
| 25 | Never commit secrets, `.env*`, `.harness/review/`, build output, or Playwright reports. | `.gitignore` + GitHub push protection |

## Examples

| Subject | Verdict |
|---|---|
| `M3.4: feat(routing): route orthogonal connectors around obstacles` | ok |
| `M1.12: test(core): add undo round-trip property for group commands` | ok |
| `M2.7: build(deps): bump zod to 4.3 in catalog` | ok (mechanical, alone) |
| `M3.4: update routing` | rejected: no type/scope, vague |
| `feat(routing): add A*` | rejected: no task ID |
| `M3.4: feat(routing): add A* and rename Router → RouteEngine` | rejected by review: refactor + behaviour |
| `M9.99: fix(core): …` | rejected: ID not in backlog |

## What no gate can check

- Whether a commit is genuinely atomic (rule 2) — the reviewer spends attention here.
- Whether the body is honest about what is unfinished (rule 11).
- Whether the human actually asked for a push (rule 23).
