---
status: accepted
date: 2026-10-16
decision-makers: harness (M15.3; within FR-AI-009 and NFR-AI-001..004; no requirement changes)
---

# ADR-0039 — Eval harness: case schema, recordings keyed by content, scorecard metrics, the alt-text metric

## Context and Problem Statement

FR-AI-009 asks for versioned prompts mapped to expected properties, runnable in CI on recorded responses and live on demand, producing a scorecard. NFR-AI-001 and NFR-AI-004 put numbers on it (valid one-shot at least 90 %, after one repair round at least 99 %, lint mean at least 85). NFR-A11Y-006 asks for alt text and reading order in generated documents but gives no number. This ADR fixes what a case is, how a model response is recorded and replayed so CI is deterministic and offline, what the scorecard measures, and how the accessibility metric is reported without inventing a threshold.

## Decision Drivers

- CI must be deterministic, offline and free: no network, no clock, no randomness in the recorded run; two runs give byte-equal output.
- A recording must go stale when the prompt, the case or the model changes, never silently match a different input.
- Live runs cost money and vary; they must be opt-in and may only refresh recordings through a stated task.
- A threshold lives in `scripts/gates/thresholds.mjs`; the harness never edits one.
- The orchestrator (M15.12) and the lint a11y rules (M15.13) are the code under test; the harness calls them through the `LlmClient` port, not a provider SDK.

## Considered Options

1. **Golden outputs per case.** Brittle: any prompt wording change rewrites every file.
2. **Recorded model responses replayed through the real pipeline (chosen).** The pipeline (parse, validate, repair, layout, lint) runs for real; only the model is replaced by its recorded bytes.
3. **Live only.** Not deterministic and not free; cannot gate a commit.

## Decision Outcome

Option 2.

**Case schema.** One JSON file per case under `eval/cases/<id>.json`, validated by a Zod schema in `packages/dsl` (`EvalCase`): `{ id, mode: 'generate' | 'edit' | 'repair', prompt, inputs?, expect }`. `expect` holds `screens?: [min, max]`, `kinds?` (element kinds that must appear), `mustContain?` (strings in titles or labels), and `minLint?`. A case with an unknown key is rejected. The set has at least 30 cases covering decks, a single diagram, mobile views, an edit by patch and a repair of a broken document. (FluxScript YAML would invite the model's own format into the test data; JSON cannot be mistaken for the output under test.)

**Recordings.** `eval/recordings/<key>.json` where `key = sha256(canonical(case) + '\n' + promptHash + '\n' + model)` in hex, `canonical` being the case with sorted keys and `promptHash` the sha256 of the **rendered** system prompt the run sends (template body, cheat sheet and catalog text as the pipeline builds them) together with the prompt-template id and the tokenizer id of ADR-0037. Hashing the content, not an id, means an edit to a template body, the catalog or a pack's entries invalidates the recordings it touches even when nobody bumps a version. A recording holds the ordered chunks the model returned for each request of the run (outline, each screen, each repair round) and the token counts the provider reported. The recorded run looks a request up by position within the run; a missing recording fails that case as `recording-missing` and the run exits 1 (never skipped). The template id (the versioned file name in `packages/dsl/prompts/`) is kept in each recording for humans and in the scorecard, as the version FR-AI-009 asks to be recorded. The reference model is named once in `eval/config.json` (`model`), as an identifier string compared by equality; the harness holds no list of models.

**Modes.** `pnpm eval --recorded` replays and is the CI job `eval-recorded` (replacing its placeholder). `pnpm eval --live` calls the configured provider through the same port with the key from the environment, is never run by a commit gate, and writes recordings only when given `--record`, in a task whose backlog row says so. Both modes write `eval/out/scorecard.json` and `eval/out/scorecard.md`; the `out` folder is generated, ignored by git, and uploaded as a CI artifact.

**Determinism.** The recorded run uses no clock, no random source and no network; cases run in id order; the scorecard has sorted keys, numbers rounded to one decimal, and no timestamp, path or duration. Latency is reported only by the live mode, in a separate `live.json`.

**Scorecard metrics.** Per run and per case: `oneShotValidPct` (the first compile of the first model output validates), `afterRepairValidPct` (valid after at most **one** repair round, which is the reading of NFR-AI-001 and FR-AI-004; the pipeline's second round of ADR-0035 is reported separately as `afterTwoRepairsValidPct` and not gated), `repairRounds` (mean), `lintMean` (mean 0 to 100 score), `expectPassPct`, `dslTokenRatio` (canonical JSON tokens over FluxScript tokens, the fixed tokenizer of ADR-0037, over the generate-mode outputs only: edit and repair outputs are patches or fragments, for which the ratio is undefined; NFR-AI-003's own corpus measure stays in `token-count.test.ts`), `tokensIn`/`tokensOut`, and `altTextCoveragePct`. The gate maps `oneShotValidPct` to `AI_ONE_SHOT_VALID_PCT`, `afterRepairValidPct` to `AI_AFTER_REPAIR_VALID_PCT`, `lintMean` to `AI_LINT_SCORE_MIN` (85, added in M15.6) and `dslTokenRatio` to `AI_DSL_TOKEN_RATIO_MIN`, all in `thresholds.mjs`; the other metrics are reported only; a failing case is listed by id with the reason.

**The alt-text metric.** `altTextCoveragePct` is the share of elements of the kinds `image`, `icon` and `group` (a group counts only when it has a `role`) that carry a non-empty `alt` or accessible label, over all generated documents; labelled shapes are outside the set because their label is their text. When no document in the run has such an element, the value is `null`, never NaN. It is **reported, not gated**: NFR-A11Y-006 states no number and none is invented here. The lint rules `FLX_LINT_ALT_MISSING` and `FLX_LINT_READING_ORDER` (M15.13) are the per-document check (M15.13: `ALT_MISSING` flags an `image`, `icon` or role-bearing `group` with no `semantic.label`, weight 2; `READING_ORDER` flags a screen of three or more elements whose index order disagrees with the visual order, rows as tall as the median element then left to right, for more than half of the pairs, weight 2; both are warnings and both codes are added to the schema's diagnostic codes and the CLI reply schemas); this metric only measures whether generation obeys them. After the first recorded baseline, the number is written into `docs/milestones/M15.md` as an observation, and a threshold can be added later only by a spec change.

### Consequences

- Good: CI proves the whole pipeline on every commit with no network and no cost, and two runs are byte-equal.
- Good: a prompt or case edit invalidates exactly the recordings it affects.
- Good: no threshold is invented; the accessibility number is visible from day one.
- Bad: recordings must be refreshed by a live run when a prompt changes, a deliberate human-triggered step.
- Bad: recorded results overfit the prompt they were taken with; the nightly live job (filed as an issue on a drop of more than 5 points) is the check.
- Bad: a repo directory of recordings that grows with the case count; each is a few KB of text.

### Confirmation

M15.12 (the orchestrator the harness drives), M15.13 (the a11y lint rules), M15.14 (the suite, 30 cases or more, recordings, byte-equal scorecards, the `eval-recorded` job), M15.15 (the gate leg reads `scorecard.json` against the thresholds and reports `altTextCoveragePct`).

## More Information

ADR-0035 (repair rounds and the lenient fallback), ADR-0037 (the tokenizer), 06-ai-authoring.md §12, FR-AI-009, NFR-AI-001..004, NFR-A11Y-006.
