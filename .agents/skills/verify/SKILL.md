---
name: verify
description: Run the deterministic gate ladder and print the evidence. Use before requesting review, before every commit, after rebasing, and whenever you need to prove the tree is green rather than assume it.
---

# Verify

Standard: `docs/standards/testing.md` §gates, `docs/standards/ci-cd.md`.

## Ladder

| Step | Command | When |
|---|---|---|
| quick | `pnpm verify:fast` (before M1: `node scripts/gates/precommit.mjs --quick`) | while iterating |
| pre-commit | `node scripts/gates/precommit.mjs --staged` | before review and commit (the hook runs it too) |
| full | `pnpm verify` (== `precommit.mjs --all`, same as CI) | after rebase, before milestone checkpoint |
| E2E | `pnpm e2e` (Playwright, chromium) / `pnpm e2e:all` | UI-affecting tasks (`ui-check`) |
| milestone | `node scripts/gates/m<N>-complete.mjs` | after every commit in `drive` |

`precommit.mjs` runs, in order, only the steps that exist at the current milestone and prints
one line per step: `PASS|FAIL|SKIP <step> (<ms>)`. SKIP must state why (e.g. "no packages yet").

## Rules

1. Run the command; paste the summary lines. Never report a status you did not observe.
2. A red step you did not cause is still your problem before committing — fix or stop (drive
   stop condition after 3 attempts).
3. Never bypass (`--no-verify`, `SKIP=`, editing thresholds). If a gate is wrong, that is its
   own task with its own review.
4. Staged vs working tree: `--staged` checks what will be committed. Stage first
   (`git add -A` on intended files only), then verify, then review, then commit **without
   restaging** — the review verdict is bound to the staged diff hash.

## Output block

```
VERIFY precommit: PASS (41.2s) — typecheck PASS, lint PASS, test PASS (412), layering PASS,
size PASS, trace PASS, portability PASS, reviewed SKIP(before review); commit-msg hook: tests-kept, drift
```
