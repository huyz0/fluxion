# Goal template

Paste into the tool's built-in goal command. Replace `<N>`.

- Claude Code: `/goal <text>` (pair with auto permission mode; headless:
  `claude -p "/goal <text>" --permission-mode auto --output-format stream-json --verbose`)
- Codex: `/goal <text>` (set a token budget; it can pause/resume)

Run in a dedicated git worktree (`git worktree add ../fluxion-m<N> -b agent/M<N>-drive`).

---

Drive milestone M<N> of this repository by following the `drive` skill
(.agents/skills/drive/SKILL.md), one backlog task per commit.

The goal is met ONLY when `node scripts/gates/m<N>-complete.mjs` exits 0 AND its full output
is printed in this conversation AND a milestone-review verdict for M<N> is recorded under
.harness/reviews/.

Each commit must first pass `node scripts/gates/precommit.mjs --staged` and have a recorded
independent review verdict (scripts/harness/review.mjs).

You must not: delete or weaken tests without a `Removes-test:` trailer; loosen any threshold;
push, publish, deploy or open PRs; edit docs/requirements/ without an ADR; work outside this
worktree.

At the end of every turn print the EVIDENCE and GATE lines defined in the drive skill and keep
.harness/progress.md and .harness/state.json current.

If a stop condition from the drive skill occurs, write it to .harness/state.json
`blockedReason` and declare the goal cannot be met, stating the reason and the next step
a human must take. Stop after 80 turns regardless.
