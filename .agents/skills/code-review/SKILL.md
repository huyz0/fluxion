---
name: code-review
description: Obtain an independent review of a staged change (or a plan with --kind plan) from an agent that did not write it, and record the verdict bound to the staged diff. Use before every commit and before coding a new milestone plan or spec. Also the procedure the reviewer itself follows.
---

# Code review

Standard: `docs/standards/review.md`.

## As the author

1. Stage exactly what will be committed. Run `verify`.
2. Build the packet: `node scripts/harness/review.mjs context --task <ID> > .harness/tmp/packet.md`
   (task row, staged diff or delta since last round, standards selected from paths, gates passed).
   The packet never contains your reasoning — do not add any.
3. Get a reviewer that is **not you**:
   - preferred: `node scripts/harness/run-reviewer.mjs --task <ID>` — runs the *other vendor's*
     CLI headless and read-only on the packet, writes `.harness/tmp/verdict.json`;
   - otherwise: dispatch your tool's isolated subagent (Claude: the `reviewer` agent) with only
     the packet file path.
4. Record: `node scripts/harness/review.mjs record --file .harness/tmp/verdict.json --task <ID>`.
   Record every round, including `changes-requested`.
5. Fix `blocking` and `major` findings, restage, repeat (max **3 rounds**; after that stop per
   `drive`). Record `minor` findings in the backlog as rows for later or argue them in
   `.harness/baselines/review-argued.txt` (`<ID> <finding-id>: <one-line argument>`).
6. Commit without restaging. `check-reviewed.mjs` refuses a commit whose staged hash has no
   `pass` verdict.

## As the reviewer

You get the task and the diff, never the author's rationale; do not look for it.

- Reconstruct intent from the task's acceptance criteria. The key question: **does the diff do
  what the task says, all of it, and nothing else?**
- Ask "what is wrong with this?", not "is this acceptable?".
- Don't re-check what gates already decided (format, lint, types, test pass/fail, layering).
- Look for: acceptance criteria not actually tested; tests that pass without constraining
  (assert on mocks, snapshot of nothing); wrong layer (DOM/time in pure package); contract
  change without ADR/migration; missing requirement ID in test names; perf hazards on hot
  paths (per-frame allocation, re-render storms); security (unsanitized input, eval);
  accessibility of UI changes; scope creep.
- Every finding: `file`, `line`, `severity` (`blocking|major|minor`), and a concrete
  `failure_scenario` (input/state → wrong result). No scenario → it is a style opinion; drop it.
- Nothing wrong? Say `pass` with zero findings. Don't invent findings.

## Verdict JSON

```json
{ "task": "M5.3", "kind": "code", "diff_sha256": "<from packet>", "reviewer": "codex:gpt-5.x",
  "verdict": "pass", "findings": [
  { "id": "F1", "file": "packages/routing/src/ortho.ts", "line": 88, "severity": "major",
    "failure_scenario": "Target left of source with obstacle between → route crosses obstacle" } ] }
```
