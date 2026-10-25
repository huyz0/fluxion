---
status: accepted
date: 2026-10-25
decision-makers: user instruction 2026-10-25; independent plan review before implementation
---

# ADR-0176 — Proportionate development gates

## Context and Problem Statement

The user cleared M18.64's three-attempt stop and asked for reasonable gates and faster
feature delivery. At main 7a0803cd, measured gzip bytes are: player core 88,958,
player-inline 148,636, embedding script 149,877, editor initial 436,404. M18.64's tested
implementation measured 150,112 bytes for the embedding script: 235 bytes growth (0.157%),
112 over its inherited target. At 1 Mbit/s, those additional bytes take about 1.9 ms to
transfer, excluding latency; this is a size calculation, not a user-performance benchmark.
Three attempts spent effort shaving bytes rather than shipping the valid endpoint fix.

The staged ladder took 316 s: tests 308 s, harness tests 185 s, typecheck 0.817 s (steps
run concurrently, so do not add them). Review context and the normal commit hook repeat
verification; drive also ran the entire milestone gate after each commit. Native TypeScript
7.0.2 is already installed: a forced project build measured 4.82 s, three warm runs
0.511–0.577 s. Replacing the compiler cannot remove the observed browser/harness cost.

The old core mutation floor of 100 came from 1,242 valid mutants in M4. Current core
execution has 41 partitions and 5,137 reported statuses, including 259 survivors and 22
uncovered mutants. These annotation counts are diagnostic, not complete identity-union
qualification. The ratchet is not a fixed requirement: NFR-MNT-005 requires 70%, and the
existing MUTATION_CORE_TARGET is 90%. M18's dependency chain made this whole-nightly
qualification a prerequisite for unrelated Mermaid/import work, contrary to ci-cd.md's
rule that nightly failures do not block ordinary development.

## Decision Drivers

Preserve correctness, security, document integrity, coverage, license policy and honest
failure reporting. Keep numerical targets meaningful and changes reviewable. Restore
feature progress without pretending existing mutation gaps or advisory overruns passed.

## Considered Options

1. Keep all gates and repeat micro-optimizations. Preserves historical rules but offers no
   proportionate user benefit for a 235-byte increase and repeats minutes of verification.
2. Remove tests or ignore all failures. Fast but hides regressions and is rejected.
3. Separate hard requirements, advisory targets and asynchronous diagnostics; measure
   overhead and retain independent review (chosen). Requires explicit classifications and
   negative probes, but preserves evidence and prioritizes actual product behavior.

## Decision Outcome

M18.66 implements this decision before resuming M18.64:

- Keep PLAYER_CORE_GZIP=150000 and EDITOR_INITIAL_GZIP=600000 as blocking limits.
  Keep the two embedding artifacts' 150000-byte targets unchanged but advisory. Measure
  every configured artifact and print its bytes and target; retain raw size-limit JSON,
  including passed:false. Unknown/missing/duplicate/malformed measurements, measurement
  tool failures and hard-limit overruns remain failures. Existing portable-document size,
  lazy-loading, loading-time, correctness and security checks remain blocking.
- Use the existing 90% core target as its explicit whole-package mutation floor, replacing
  the historical 100% ratchet. Other packages retain their existing applicable floors and
  NFR-MNT-005's 70% minimum. Preserve every source, mutant, test project, raw report, job
  timeout and retry setting. Score and incomplete-execution failures remain red; no
  partial report can qualify a package. Record the change with Threshold-change and this ADR.
- Whole-suite mutation is a nightly/final qualification check, not a prerequisite for
  independent feature rows. Move M18.10's outstanding qualification alongside final
  closeout, remove the artificial M18.11 dependency, and retain the final evidence gate.
  Touched behavior still needs meaningful regression tests and independent review.
- Run the full milestone completion command at checkpoints and final closeout, not after
  every task commit. Each task still has a scoped review-packet verification and normal
  pre-commit hook, plus automatic full CI. Do not cache/reuse verification across changed
  bytes or remove any test. Receipt-based hook deduplication is deferred until a separate
  design proves revision, staged/worktree, dependency and toolchain identity.
- Three unsuccessful attempts stop the current approach and trigger an independent
  diagnostic review and explicit replan within authorized scope. They do not automatically
  require another user approval. Human escalation remains for unresolved scope/requirements,
  security or license policy, destructive actions, denied access, or needed authorization.
  Preserve all attempts; never reset counters to repeat the same approach unreviewed.
  Keep the per-change independent-review cap and no-bypass rules.

## Consequences and Confirmation

The embedding script may exceed its target, visibly; core/editor hard budgets remain.
Core's 90% floor still demands substantial mutation detection without treating every
human-message survivor as a feature blocker. Existing run 40220828558 stays under its
original rules and is never relabeled as passing the new policy. Current-revision final
qualification must use the new reviewed policy and complete reports.

Probe hard/advisory overages, missing/invalid/duplicate results and tool failures. Assert
core floor90 and other floors unchanged; keep aggregate negative tests intact. Review the
backlog dependency graph and skill adapters. Run scoped and full CI validation, preserve
all old red evidence, then qualify and publish M18.64's actual user-facing fix.

## Tooling Follow-up

TypeScript is already native; TS6 remains for compiler-API consumers. Keep Node/pnpm,
Vitest/Playwright and declaration generation authoritative. The user's provisional tsrs
versus Bun research must compare pinned versions, same source/config, cold/warm/incremental
runs, deliberate-error diagnostics and exit parity, declarations and browser compatibility.
No runtime migration is authorized by a timing claim alone. Bun is not installed here.

## Links

- [Implementation spec](../../../specs/archive/M18-gate-policy/proposal.md)
- [NFR-SIZE and NFR-MNT](../../requirements/30-non-functional.md)
- [Mutation tool and original floor policy](ADR-0146-mutation-testing-tzap.md)
- [Player packaging](ADR-0026-player-packaging.md)

This ADR amends the embedding-artifact enforcement inherited from M11.18 and ADR-0146's
core ratchet policy; it does not supersede their packaging or mutation-tool decisions.
