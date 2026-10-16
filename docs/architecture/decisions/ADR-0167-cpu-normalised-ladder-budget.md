---
status: proposed
date: 2026-10-16
decision-makers: proposed by harness (M14.22); needs the human's approval, because it changes how a gate is enforced
---

# ADR-0167 — A CPU-normalised ladder budget

Proposal only. It changes no value in `scripts/gates/thresholds.mjs` and nothing enforces it until a human accepts it.

## Context and Problem Statement

The staged and quick ceilings were raised three times in three days (ADR-0164, ADR-0165, ADR-0166) because the same unchanged worst-case ladder measured 446 s to 616 s on a shared container. A fixed wall-clock ceiling measures the machine as much as the code, so it either fails on noise or is set so loose that a real regression hides under it.

## Considered Options

1. **Keep fixed ceilings** (today: quick 180 s, staged 900 s) and raise them when noise exceeds them. Simple, but each raise weakens the gate and spends a human decision.
2. **Normalise by a calibration measure.** Run a fixed, deterministic CPU workload (the calibration) next to each recording, store its time with the ladder time, and compare the ratio. The ceiling is `ratio_max * calibration_now`, where `ratio_max` is the committed number.
3. **Move timing enforcement to CI only**, on one fixed runner class. Stable, but local commits lose the early signal.

## Decision Outcome (proposed)

Option 2. The measure is the wall time of a pure calibration script (`scripts/gates/calibrate.mjs`, a fixed hash and sort workload of about 2 s, no I/O beyond reading itself), taken as the median of three runs immediately before the ladder. `check-budget.mjs` would record `{ladderMs, calibrationMs}` and fail when `ladderMs / calibrationMs` exceeds the committed `PRECOMMIT_RATIO_MAX`. The committed numbers stay: the absolute ceilings (quick 180 s, staged 900 s) remain a hard upper bound, so normalisation can only make a slow machine pass, never lift the cap. The CI cold-setup authority (ADR-0143, ADR-0145) is unchanged: a cold-setup time is judged from the green CI run, not from a local run.

## What a human must approve

- That a ratio is an acceptable stand-in for wall time, which loosens the gate on a slow machine.
- The initial `PRECOMMIT_RATIO_MAX`, to be derived from at least ten recordings on the CI runner class, not from this container.
- That the calibration script is exempt from the budget check itself.

## Consequences

- Good: container noise stops forcing ceiling raises; a real regression shows as a ratio change.
- Bad: one more script and one more recorded number; a calibration that does not track the ladder's real mix (I/O, Chromium start) can mislead.
- Not done here: no script, no threshold and no change to `check-budget.mjs`.

## Confirmation

If accepted: `tests/harness/budget.test.mjs` reads the ratio and the absolute caps from `thresholds.mjs` and fails when the cap is exceeded whatever the ratio. Until then `node scripts/gates/m14-complete.mjs` only checks that this ADR is on file as `proposed`.
