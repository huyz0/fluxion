---
status: accepted
date: 2026-10-26
decision-makers: user reasonable-gates instruction2026-10-25; independent plan review PASS0 on 2026-10-26
---

# ADR-0190 — Quick latency remains visible without blocking correct changes

Supersedes ADR-0164 elapsed-time enforcement only; keeps180000ms target.

## Context and Problem Statement

The controlled M18.85 run passed quick correctness checks but took200289ms (193112ms tests),20289ms/11.3% beyond target. The manifest change forced2766tests/533files including382Chromium cases. Worst-case staged417311ms passed its900000ms limit. Earlier224783ms failure and controlled failure are retained. A quick iteration command's selected workload varies with manifests, making elapsed-time failure a poor correctness boundary. User explicitly authorized reasonable evidence-based gates; independent diagnostic review supports a separate policy change, not rewriting history.

## Decision Drivers

NFR-DX-002 iteration feedback,NFR-DX-003 deterministic automation,NFR-MNT-004 verification integrity. Preserve all correctness/security checks,coverage,test selection/timeouts,staged/cold hard limits and actual measured failures.

## Considered Options

1. Keep hard quick timing and optimize solely to recover20seconds. Retains enforcement but no proven optimization exists; repeated full-suite measurement delays feature delivery.
2. Reduce tests or raise a numeric threshold. Faster or less blocking, but loses coverage or merely moves the same workload-dependent boundary; rejected.
3. Keep the numeric target with explicit advisory output and unchanged verification (chosen). Avoids a development latency target blocking correct changes, while retaining regression visibility; latency can worsen without blocking.

## Decision Outcome

For every quick invocation, a successful check set exceeding180000ms reports ADVISORY with actual,target,delta and exits successfully. Any failed subcheck still fails, regardless of elapsed time. No test selection or execution change. Staged900000ms and cold600000ms remain blocking. M0's independent elapsed-time check follows the same policy and surfaces captured warnings.

Budget records retain schema: quickMs is a positive finite elapsed measurement only from a successful subprocess; failed runs remain null and cannot qualify. Missing,invalid,zero,negative and nonfinite values fail. Over-target successful quick values are advisory; staged/cold over-target values fail. Lockfile identity and pending-cold restrictions remain unchanged. Historical failed records are not converted or filled from logs. Fresh measurement and revision-bound review are required after implementation.

## Consequences and Confirmation

Quick performance regression warnings remain visible in normal,summary and GitHub output. Existing execution/test timeouts and staged/cold limits remain hard; no failed/hung check becomes successful. Tests prove timing boundaries,failed-subcheck propagation,invalid measurements,hard-limit failures,pending/stale-lock behavior and M0 warning propagation. Exact staged review,independent code review,normal hooks and CI precede publication. No runtime dependencies or workflow scope changes.

## More Information

See specs/M18.86-quick-latency and ADR0176. Original evidence /workspace/fluxion-M18.85-budget-controlled.log; independent replan /workspace/fluxion-M18.85-policy-replan-review.md. M18.85 implementation remains unqualified and separate.
