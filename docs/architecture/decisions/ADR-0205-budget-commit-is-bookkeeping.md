---
status: accepted
date: 2026-10-28
decision-makers: harness (M18.155; cp17 F2; amends ADR-0195, subject to independent review)
---

# ADR-0205 — The budget record's `commit` follows landing, outside the review identity

## Context and Problem Statement

`.harness/budget.json` names the commit it measured (`check-budget --record` writes HEAD). A
record taken in a local stack names a local commit; `land.mjs` re-applies the stack onto a moved
`main`, so the landed record names a sha that never reaches `main` (ff07c52's record named
8d27ab1, cp17 F2). check-budget then cannot trace the record or read its lockfile in a fresh
clone. M18.155 makes `land.mjs` rename it, as it renames backlog Commit cells (M18.153). But the
record is reviewed content under ADR-0195, so a renamed sha changes the commit's identity and
the landed commit no longer matches its review.

## Considered Options

1. **Exclude `.harness/budget.json` from the identity.** The measured numbers would then land
   unreviewed. Rejected.
2. **Bind the identity to the record with only its `commit` value dropped.** Chosen.
3. **Record a tree id or nothing instead of a commit.** The lockfile lookup (ADR-0145) reads the
   record's commit; changing the record format is wider than the defect. Rejected.

## Decision Outcome

- `review-content.mjs` drops the value of the `"commit"` line inside `.harness/budget.json`'s diff
  before hashing (`<commit>` placeholder); every other byte of the record stays bound.
- Identities recorded before this decision bound that value. `contentIds()` returns the current
  identity and, when it differs, the pre-0205 one; `check-reviewed`, `check-digest` and
  `review.mjs record` accept either, so earlier evidence still binds. The two differ only for a
  change to that one line, so every other commit keeps a single identity.
- `land.mjs` renames a record's `commit` naming a commit the landing rewrote, in the re-applied
  commit and in the trees of commits still to apply (M18.153's remap), and check-budget refuses,
  outside CI, a record whose commit is not on HEAD's history (a shallow clone or no repository
  cannot tell, and says so).

### Consequences

Good: a landed record names a landed commit, and landing it needs no new review. Bad: a hand-edit
of only the record's `commit` is not bound by review; check-budget's ancestry and lockfile checks
still catch a wrong value locally.

### Confirmation

`tests/harness/review.test.mjs` proves a changed `commit` value keeps the identity, a changed
number does not, and a verdict and digest line carrying the pre-0205 identity satisfy
check-reviewed. `tests/harness/land.test.mjs` lands a two-commit stack whose second commit records
the budget at the first onto a moved remote, and the landed record names the landed first commit.
`tests/harness/budget.test.mjs` proves an off-history or unknown commit fails check-budget
locally and not in CI.
