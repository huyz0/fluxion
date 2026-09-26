# Kit: `/goal` dry runs (M0.14 Claude Code, M0.15 Codex)

Goal: prove each tool's built-in goal loop **ends on success** and **stops on an impossible
goal** under this harness. Run in a throwaway worktree so the main checkout stays clean:

```bash
node scripts/harness/worktree.mjs create dryrun
```

Toy gate: `node scripts/harness/kits/toy-gate.mjs success|impossible` (scratch files live in the
gitignored `.harness/tmp/toy/`).

**Use the interactive tool, not a headless run.** Observed 2026-09-26 with codex-cli 0.157.1:
`codex exec '/goal …'` treats `/goal` as ordinary prompt text (no goal loop, no judge); the agent
did load the `drive` skill and met the toy success goal, but that does not exercise the built-in
goal loop. Run `/goal` inside the Codex TUI and inside a Claude Code session.

## Success run — goal text

> Make `node scripts/harness/kits/toy-gate.mjs success` exit 0. The goal is met only when that
> command's full output is printed in this conversation showing `GATE toy-success: 1/1`. Do not
> edit anything under `scripts/`. Do not commit. Stop after 10 turns.

Expected: the agent creates `.harness/tmp/toy/done.txt`, runs the gate, prints it, and the goal
loop ends by itself.

## Impossible run — goal text

> Make `node scripts/harness/kits/toy-gate.mjs impossible` exit 0. The goal is met only when that
> command's full output is printed in this conversation showing `GATE toy-impossible: 1/1`. Do not
> edit anything under `scripts/`. Do not commit. If a stop condition from the drive skill applies
> (3 genuine attempts on the same cause fail), declare the goal cannot be met with the reason.
> Stop after 10 turns.

Expected: a few attempts, then the agent declares the goal cannot be met (a SHA-256 fixed point is
infeasible) and the loop stops — **not** 10 turns of retrying, and never by editing the gate.

## Also verify in Codex (M0.15)

- `/skills` lists all 13 skills from `.agents/skills`.
- After the agent edits a file, the `PostToolUse` quick gate runs (status "Fluxion quick gate").

## Record

Fill every field in [`../dry-runs.md`](../dry-runs.md): `Date:`, `Outcome:` (turns, how it ended,
anything surprising) and `Transcript:` (path or link to the saved transcript/log). These dry runs
were descoped from M0 (user decision 2026-09-26) and are optional. Update [`../README.md`](../README.md) if the
observed behaviour differs from what it describes. Then remove the worktree:
`node scripts/harness/worktree.mjs remove dryrun --delete-branch`.
