---
status: accepted
date: 2026-10-25
decision-makers: human authorization 2026-10-24, implemented by harness M18.6
---

# ADR-0171 — Keep circular-500 timing measured but advisory

## Context and Problem Statement

The user explicitly made circular-layout performance nice-to-have after a reported
500-node timing overrun: “Tell it to loosen the threshold it is nice to have not must.”
The delegated scope limits that exception to circular timing. Correctness, security,
coverage, mutation, other performance budgets and zero retries remain mandatory.

The previous interrupted executor's changes were not recovered. Its reported timings
are historical context, not qualification evidence for this checkout. This change gets
fresh tests, independent review and the unchanged benchmark fixture.

## Decision Drivers

- Apply the authorized exception without hiding measurements (NFR-PERF-005).
- Keep malformed, missing or failed benchmark evidence blocking.
- Keep all non-circular performance enforcement and circular correctness intact.
- Add M18's already-required font/import constants without changing their values.

## Considered Options

1. **Raise LAYOUT_500_NODES_MS.** Would weaken every layout and exceeds authorization.
2. **Skip the circular benchmark.** Hides measurements and could conceal failures.
3. **Measure normally and report only its timing overrun as advisory.** Chosen; preserves
   the target and evidence, with a narrow change to the consequence of an overrun.

## Decision Outcome

Keep `LAYOUT_500_NODES_MS = 2000`. Run the existing `circular-500.bench.ts`, including
its unchanged 500-node graph and benchmark settings. Validate successful process exit,
JSON structure, passing assertions, exactly one named circular-500 measurement and a
finite nonnegative numeric p99 before evaluating timing. Invalid evidence fails.

A valid circular p99 at or below 2000 ms prints PASS. A valid overrun prints ADVISORY,
including measured p99 and the unchanged 2000 ms target, and does not fail the completion
gate. No retry, alternate fixture, baseline update or discarded sample is introduced.
The script does not accept a different benchmark name or a flag to relax another gate.

All circular correctness tests still block. Force, packing, timeline and swimlane remain
under the same mandatory 2000 ms budget; layered/tree/radial/mindmap and routing keep
their existing gates. ADR-0170's calibration algorithm, regression tolerance and stored
baselines are unchanged. This supplements that ADR only for the explicitly named
circular completion-gate timing. The current nightly calibrated list does not include
circular; do not broaden or change it as part of this exception.

Add these constants directly from existing acceptance criteria: FR-AST-003
`FONT_SUBSET_LATIN_MAX_BYTES = 60000` (maximum), FR-LIB-004 `SVG_IMPORT_MIN_ANCHORS = 4`
(minimum), FR-LIB-006 `DRAWIO_LIB_IMPORT_MIN_PCT = 90` (minimum). They are mandatory;
this ADR does not give them advisory status or change the fixture denominators.

## Consequences and Confirmation

Circular timing regressions remain visible but no longer block delivery by themselves.
The special case needs regression coverage so it cannot become a general pass-through.
`circular-advisory.test.mjs` proves an overrun is advisory, every other M18 layout overrun
fails, and malformed/missing/duplicate samples, failed/skipped assertions and nonzero
process exits fail. CLI probes verify exit status; synthetic reports test the judge,
not performance. The completion gate runs the real benchmark and circular correctness.

NFR-PERF-005, the M18 spec and traceability matrix change in the same commit. No existing
threshold is raised; the commit's Threshold-change trailer records the authorized change
in timing enforcement. M18.9 separately handles unread historical millisecond baselines.

## More Information

- ADR-0170; NFR-PERF-005; M18.6; `scripts/gates/m18-complete.mjs`.
- User authorization dated 2026-10-24 in the delegated conversation history.
