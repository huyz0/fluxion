---
status: accepted
date: 2026-10-27
decision-makers: harness (M18.99; cp9 F1, cp10 F2, cp11 F1/F2; amends review standard R4, subject to independent review)
---

# ADR-0195 — Reviews bind to rebase-stable content, and each commit carries its own evidence

## Context and Problem Statement

A verdict was bound to `sha256(git diff --cached)`, and `record` appended its tracked digest line
after hashing, so the line could only land in a later commit. With four streams rebasing onto a
fast-moving main, every rebase changed the hash: checkpoint cp11 found none of ten landed diffs
matched a digest entry, and cp9/cp10 found task commits with no tracked evidence at all (the
evidence of the last commit of a stream waits for that stream's next commit, or is lost).

## Decision Drivers

- A review must survive a rebase that only moves a change onto unrelated work, and must not
  survive any change to what the reviewer saw.
- Evidence must be durable in history (non-negotiable 4) and checkable by a gate.
- Bookkeeping and generated reports must not force a new review.

## Considered Options

1. **Keep the byte hash; re-review after every rebase.** Honest but serialises streams on
   reviewer time, and still leaves evidence one commit late. Rejected.
2. **Bind to the tree hash of reviewed paths.** Changes whenever main touches any of those
   files elsewhere. Rejected.
3. **`git patch-id --stable`.** Line-number free, but it strips all whitespace, so
   `rm -rf /tmp/x` → `rm -rf / tmp/x` or a YAML re-indent keeps the identity (review r1 F1).
   Rejected.
4. **Content identity: a hash of the diff without bookkeeping and generated API reports, with
   only blob ids and hunk line numbers dropped, plus backlog spec cells and hand-written
   traceability cells.** Chosen.

## Decision Outcome

- `scripts/gates/review-content.mjs` computes the identity of the staged change or of one commit.
  Excluded: `.harness/progress.md`, `.harness/state.json`, `.harness/reviews/**`,
  `.harness/baselines/review-argued.txt` and `{packages,packs,apps}/*/api/*.api.md`
  (regenerated, and checked by check-api on every commit). The diff keeps every byte except
  `index` lines and hunk line numbers, so a hunk moved by unrelated edits keeps its identity;
  changed whitespace, context or content does not. The backlog counts as each changed row's
  cells except State and Commit, with a change to `descoped` kept as spec. Traceability counts
  as the multiset of changed lines with each matrix row's generated Tests cell dropped, so
  hand-written cells (Milestone(s)) stay bound.
- `review.mjs context` prints `content_id`; `record` stores it in the verdict and as a 7th digest
  field `content:<id>`, and accepts a verdict whose byte hash or content identity matches. The
  digest is staged with the commit it reviews. `--commit <sha>` reviews a landed commit after the
  fact and binds to that commit's identity (evidence recovery).
- `check-reviewed.mjs` requires a local `pass` verdict for the staged content identity and the
  same pass line in the staged digest. A change of only bookkeeping and generated reports is exempt.
- `check-digest.mjs` (ladder step `digest`, M18 completion leg): from the commit that adds it, each
  task commit of the active milestone must carry in its own tree a pass line for its task bound to
  its own identity. Earlier task commits need a tracked pass line for their task or a line in
  `.harness/baselines/digest-exempt.txt`. A done row needs its Commit cell once a later commit
  exists; checking the index, the pending commit is that later commit. A shallow clone (CI's
  depth-1 verify checkout) skips with a reason; the local ladder and the completion gate run it
  on full history.

### Consequences

Good: a rebase over unrelated work keeps the review; evidence is in the commit it covers; a gate
finds missing evidence and Commit cells. Bad: hand-edited API reports or traceability are not
bound (their gates still fail a mismatch); landing a rebased commit still needs the ladder rerun
on the rebased tree (M18.106).

### Confirmation

`tests/harness/review.test.mjs` proves bookkeeping, argued lines, generated reports and the
traceability Tests column leave the identity unchanged; content, whitespace, new files, backlog
spec cells, descoping, new rows and hand-written traceability cells change it; a
rebase onto unrelated work passes check-reviewed; and an after-the-fact record needs the
commit's identity. `tests/harness/digest.test.mjs` proves pre-adoption task coverage and
exemptions, own-tree content-bound lines after adoption, the Commit-cell rule in both modes and
the shallow-clone skip.

## More Information

docs/standards/review.md R4, ADR-0176 (diagnostic replan), M18.106 (re-gated landing).
