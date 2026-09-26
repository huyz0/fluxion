# Review

> Read when: about to commit (every commit needs a verdict), acting as a reviewer, deciding
> whether a finding blocks, arguing a finding, or running a milestone review.
> Family: Process · Related: [git.md](git.md), [sdd.md](sdd.md), [testing.md](testing.md)

No human reads most of Fluxion's code. Review is therefore done by **an agent that did not
write the change**, sees only the evidence, and must bind its verdict to the exact diff. Scripts
check everything a script can; the reviewer spends attention only on what they cannot.

## 1. Two loops

| Loop | Scope | Who | When | Output |
|---|---|---|---|---|
| Per-commit | one task's staged diff | an isolated reviewer subagent (other vendor's CLI only on human request) | before every commit | `.harness/review/<sha256>.json` (gitignored) |
| Milestone | all commits of the milestone, files as they now stand | a fresh agent that did not drive the milestone | ~every 8 commits and before completion | `.harness/reviews/milestone-M<n>-<k>.json` (tracked) |

## 2. Per-commit flow

```sh
git add -p                                            # stage exactly the task
node scripts/harness/review.mjs context --task M3.4   # → .harness/review/packet.md
# an isolated reviewer subagent reads only the packet and returns verdict JSON
node scripts/harness/review.mjs record --file v.json  # validate + store by diff hash
git commit                                            # check-reviewed.mjs finds the verdict
```

**Reviewer = an isolated subagent** of the authoring tool (Claude: `.claude/agents/reviewer.md`;
Codex: a fresh subagent), given only the packet — project decision 2026-09-26. Cross-vendor CLI
review (`run-reviewer.mjs`: `codex exec` read-only / `claude -p --agent reviewer`) is optional,
used when a human asks for it; M0.13 showed both directions catch seeded defects.

## 3. Rules

| # | Rule | Enforced by |
|---|---|---|
| R1 | **Allocation:** anything a script can decide (format, types, tests, coverage, layering, size, message shape) is never delegated to review. The packet lists gates already passed so the reviewer does not redo them. | `review.mjs context` |
| R2 | **The packet contains:** the backlog row verbatim (ID, Req IDs, EARS acceptance), the staged diff (or the delta since the previous round), the standards selected from staged paths, the passed-gate list, and linked spec folder if any. | `review.mjs context` |
| R3 | **The packet never contains** the author's reasoning, plan, transcript, or summary of the change. Rationale persuades; the reviewer grades code, not arguments. Commit body drafts are excluded too. | `review.mjs context` (fixed template) |
| R4 | The verdict is bound to `sha256(git diff --cached)`. Any restage invalidates it. | `check-reviewed.mjs` |
| R5 | No commit without a matching verdict of `pass`, or of `changes-requested` whose blocking and major findings are all fixed or argued. | `check-reviewed.mjs` |
| R6 | Every finding has `file`, `line`, `severity`, and a concrete **failure scenario** (input → wrong outcome). "Could be cleaner" without a scenario is not a finding. | `review.mjs record` (schema) |
| R7 | The reviewer works adversarially: assume the diff is wrong and try to show how. Check acceptance criteria one by one against tests, not against the diff's comments. | no gate — reviewer prompt |
| R8 | The reviewer may read the repository and run read-only commands (tests, grep). It never edits files. | reviewer sandbox / agent tools |
| R9 | **Round cap: 3.** Round 2+ reviews only the delta plus open findings. After round 3 with blocking findings open, the drive loop stops and asks the human. | `review.mjs` (round counter in `.harness/state.json`) |
| R10 | A finding is **fixed** (new diff → new round) or **argued**: one line appended to `.harness/baselines/review-argued.txt` (`<task> <finding-id> <reason>`). Argued findings are re-read at milestone review. | `check-reviewed.mjs` |
| R11 | **Minors** are recorded in the commit body, never trigger another round, and may be fixed in a later task. | `check-reviewed.mjs` ignores minors |
| R12 | A semantic finding that recurs twice across tasks is a gap in the gate set: add a backlog row for a new gate. | no gate — milestone review checks |
| R13 | A diff that edits a standard, gate, or threshold obliges the reviewer to read the edited file in full. | `review.mjs context` (includes whole file) |

## 4. Severity

| Severity | Meaning | Blocks commit? | Examples |
|---|---|---|---|
| `blocking` | Wrong behaviour, broken acceptance criterion, data loss, security hole, test weakened | yes | undo leaves orphan connector; sanitizer lets `onload` through |
| `major` | Correct now but likely to break: missing test for an EARS clause, contract drift, layering bypassed via a type import, refactor mixed with behaviour | yes, on `changes-requested` | new command lacks undo property test |
| `minor` | Naming, small duplication, comment accuracy | no | helper named `tmp2` |

## 5. Verdict JSON

```json
{
  "task": "M3.4",
  "diff_sha256": "9f2c…e1",
  "verdict": "changes-requested",
  "findings": [
    {
      "id": "F1",
      "file": "packages/routing/src/orthogonal.ts",
      "line": 88,
      "severity": "blocking",
      "failure_scenario": "Obstacle touching the source port: grid excludes the port cell, A* returns null, connector disappears instead of falling back to straight route."
    }
  ],
  "reviewer": "codex exec <model> (cross-vendor)"
}
```

`review.mjs record` rejects: unknown `task`, hash mismatch, missing fields, a `pass` with
blocking findings, or findings without `failure_scenario`.

## 6. Milestone review

| # | Rule | Enforced by |
|---|---|---|
| M1 | Run at a checkpoint (~8 commits since the last one) and before `m<n>-complete.mjs` may pass. | `m<n>-complete.mjs` requires a verdict covering every milestone commit |
| M2 | The reviewer is fresh (no drive transcript) and reads files as they now stand, plus `git log` for the milestone. | no gate — harness |
| M3 | Look for what per-commit review cannot see: drift between packages, contradictions between individually-approved changes, abstractions to extract or collapse, standards no longer followed, gates passing for the wrong reason, docs claiming what code no longer does, the plan or spec itself being wrong. | reviewer prompt |
| M4 | Each finding gets a **disposition** when filed: `reopen` (new row in this milestone), `handoff` (row in the next milestone plan's Deferred table), or `argue`. | `check-milestone-handoff.mjs` |
| M5 | The milestone ends by disposition, not by an empty finding list. | `m<n>-complete.mjs` |

## 7. What review cannot prove

The hash proves the verdict matches the diff; it cannot prove the reviewer was not the author.
Isolation comes from the reviewer subagent definitions (fresh context, packet only), and a human spot-checks
`reviewer` fields at milestone boundaries.
