# Harness operator guide

For the **human** who starts, watches and unblocks autonomous agent loops. Agents follow
[`AGENTS.md`](../../AGENTS.md) and the skills; this page is how to run them.

## 1. One-time setup

| Need | Why | Check |
|---|---|---|
| Node ≥ 22 **on PATH** | every gate and git hook is `node scripts/...` | `node --version` in the shell your agent uses |
| pnpm 11 | workspace from M1 | `pnpm --version` |
| git | hooks, worktrees, review hashing | `git --version` |
| Claude Code and/or Codex CLI, logged in | the agents; the *other* one is the preferred reviewer | `claude --version`, `codex --version` |

```bash
node scripts/harness/setup.mjs
```

This sets `core.hooksPath=.githooks`, marks hooks executable, and regenerates `.claude/skills`.
Codex only: trust the project `.codex/` layer when prompted (hooks re-prompt when changed).

## 2. Start a milestone loop

1. Check `docs/milestones/roadmap.md` → **Current milestone**, and that `.harness/state.json`
   has no `blockedReason`.
2. One session per worktree:
   ```bash
   node scripts/harness/worktree.mjs create m1-drive
   ```
3. In the worktree, start the tool's goal loop with the text in
   [`.agents/skills/drive/references/goal-template.md`](../../.agents/skills/drive/references/goal-template.md)
   (replace `<N>`). Claude: `/goal …` with auto permission mode. Codex: `/goal …` with a token
   budget.
4. Optional: if the goal judge accepts passes that aren't real, use the deterministic Stop hook
   instead of `/goal` — see [`.harness/README.md`](../../.harness/README.md). Never both.

## 3. Watch it

| Where | What it tells you |
|---|---|
| Transcript `EVIDENCE` / `GATE` lines | per-turn task, precommit, review, commit, gate progress |
| `node scripts/gates/m<N>-complete.mjs` | the only definition of "done" (one line per leg) |
| `.harness/progress.md` | ≤ 10-line entry per task/session |
| `.harness/state.json` | current task, attempts, `loopActive`, `blockedReason` |
| `.harness/reviews/digest.log` | every recorded review verdict (task, diff hash, round, verdict, reviewer) |
| `.harness/reviews/milestone-*.json` | checkpoint and final milestone reviews with dispositions |
| `git log --oneline` | one commit per task, subject `<TaskID>: <type>(<scope>): …` |

## 4. Stop, unblock, resume

- The loop stops itself on the conditions in AGENTS.md ("Stop and hand back") and writes the
  reason to `state.json` → `blockedReason`. Read the last progress entry, decide, then clear
  `blockedReason` and delete `.harness/tmp/stop-blocks` (the Stop-hook counter persists until the
  gate goes green, so a stale count would end the resumed loop early).
- Decisions the loop must not make alone: requirement/scope changes, licence posture, file-format
  major versions, anything outward-facing (push, publish, release) — use the `ship` skill only
  when you want that.
- Resume by re-running the same goal text; the `drive` skill re-orients from files, not memory.

## 5. Finish a milestone

The milestone is done when its gate exits 0 **and** a fresh-agent final milestone review is
recorded. Then merge the worktree branch (rebase, keep one commit per task), move the roadmap's
**Current milestone** forward, and remove the worktree:
`node scripts/harness/worktree.mjs remove m1-drive --delete-branch`.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `git commit` fails with `node: not found` | Node not on PATH for git hooks (Windows: restart the shell after installing Node) |
| Hooks silently don't run on macOS/Linux | hooks lost the executable bit — rerun `setup.mjs` (tracked mode is 100755) |
| `reviewed: no pass verdict` after a pass | you restaged after review; the verdict is bound to the exact staged bytes — review again |
| Tests pass alone but fail inside the hook | git exports `GIT_*` vars to hooks; test sandboxes must use `cleanEnv()` from `tests/harness/helpers.mjs` |
| Codex quick gate never runs | project `.codex/` layer not trusted, or a Codex version where repo-local hooks don't fire (openai/codex#17532) |
| Review loop exceeds 3 rounds | by design the loop stops; read the findings, decide, clear `blockedReason` |
| Stop hook allows stopping immediately | `blockedReason` set, loop inactive, or runaway cap reached (delete `.harness/tmp/stop-blocks`) |

## 7. Hand-back checklist: finishing M0 (needs a human)

The loop stopped because M0.13–M0.15 need the Claude Code and Codex CLIs installed and logged
in (`state.json` → `blockedReason`). Everything that can be prepared without them is ready:

1. **Node on PATH** in the shell git uses (`node --version`), then `node scripts/harness/setup.mjs`.
2. **Install and log in** to both CLIs (`claude --version`, `codex --version`); trust the project
   `.codex/` layer in Codex.
3. **M0.13 reviewer smoke:** `node scripts/harness/kits/smoke.mjs` — seeds one defect per
   direction in a throwaway worktree, runs the other vendor's reviewer, and writes
   `.harness/reviews/cross-vendor-smoke.json` plus digest lines. Nothing seeded is left behind.
4. **M0.14 / M0.15 `/goal` dry runs:** follow [`kits/dry-run.md`](kits/dry-run.md) in each tool and
   fill every `Date:` / `Outcome:` / `Transcript:` in [`dry-runs.md`](dry-runs.md).
5. **CI check** (M0 cp2 F3): run `actionlint .github/workflows/gates.yml` or push once and confirm
   the `gates` workflow is green on all three OSes.
6. **Resume:** set the M0.13–M0.15 rows back to `todo`, clear `blockedReason`, delete
   `.harness/tmp/stop-blocks`, and start `/goal` with the M0 goal text. The agent commits the
   evidence (M0.13–M0.15), runs the final milestone review (M0.18) and moves the roadmap to M1.
