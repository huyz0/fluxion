---
status: accepted
date: 2026-10-16
decision-makers: harness (M14.4; within NFR-AI-002 and NFR-AI-003; adds the threshold AI_DSL_TOKEN_RATIO_MIN and one dev dependency; no requirement changes)
---

# ADR-0037 — One pinned offline tokenizer counts every AI token budget

## Context and Problem Statement

Two requirements are stated in tokens: NFR-AI-002 (the catalog plus the cheat sheet fit `AI_CATALOG_MAX_TOKENS`, 8,000) and NFR-AI-003 (FluxScript costs at most a third of the canonical JSON, a ratio of at least `AI_DSL_TOKEN_RATIO_MIN`, 3). Every model has its own tokenizer, the vendors' counters are network services, and a test that calls one is slow, flaky and not reproducible. The budgets still need a number a test can compute offline and a fresh agent can reproduce. Which tokenizer counts, and how is its disagreement with the real models handled?

## Decision Drivers

- A test must run offline, deterministically, in the node project, in milliseconds per file.
- The count must be reproducible: pinned package version, pinned encoding, no network.
- No runtime dependency: the tokenizer is a measuring instrument for tests, never shipped (non-negotiable 8 needs a licence check and a reason; the player has no new dependency).
- The real models' tokenizers differ from any proxy; the ADR must say so and not invent a margin (sdd.md rule 1).

## Considered Options

1. **`gpt-tokenizer` with the `o200k_base` encoding, exact-pinned (chosen).** MIT licence, no dependencies, pure JavaScript, the encoding of current OpenAI models, importable per encoding so only one vocabulary loads.
2. **The tokenizer of each target model, called through its API.** Closest to the truth, but needs keys and the network, differs between providers, and drifts when a model changes.
3. **A characters-divided-by-four estimate.** Free, but off by a different factor for JSON (punctuation-heavy) and YAML (word-heavy), which is exactly the comparison NFR-AI-003 makes.
4. **`js-tiktoken`.** Same encodings; larger install and a WASM-free but heavier API for the same result.

## Decision Outcome

Option 1.

**The instrument.** `gpt-tokenizer@4.0.3` (MIT) is a **dev dependency of `@fluxion/dsl`**, exact-pinned. Tests import only `gpt-tokenizer/encoding/o200k_base`, through one module (`packages/dsl/src/__fixtures__/token-count.ts`, `countTokens(text): number`), so the encoding is named in one place. Fixtures are the one place a package's `src` may import a dev dependency (the layering gate's `not-to-dev-dep`); shipped code never imports it. A later consumer outside tests (the CLI `catalog` budget flag, the docs build) needs its own decision to make it a real dependency.

**The thresholds.** `AI_CATALOG_MAX_TOKENS` (8,000, weakens up, existing) is a limit in o200k tokens. `AI_DSL_TOKEN_RATIO_MIN` (3, weakens down, added by this ADR) is the lowest accepted ratio of canonical-JSON tokens to FluxScript tokens over the whole `examples/dsl/` corpus (sum over files, not the mean of per-file ratios, so one tiny file cannot hide a bad one). Both are enforced by tests in `pnpm verify` (M14.8, M14.19).

**The error margin is UNDERIVED.** How far o200k counts differ from a given Claude, GPT or Gemini tokenizer on catalog text and on FluxScript is not measured, and this ADR states no number. M15's eval suite measures it against each provider's own counter on the same texts and records the result in this ADR's Confirmation section by amendment; until then the budgets are claims about o200k tokens, and a model with a larger token count for the same text would see a catalog above 8,000 of its own tokens. If the measured margin is worse than the budget can absorb, the remedy is a lower `AI_CATALOG_MAX_TOKENS` (a tightening, which `check-drift` accepts), not a different instrument.

**Not for billing or limits.** A token count from this module is a regression guard and a comparison between two texts, never a prediction of a request's cost or a context-window check.

### Consequences

- Good: both token budgets become ordinary, offline, reproducible tests.
- Good: the install grows by one MIT package with no dependencies (its 27 MB unpacked size is all vocabularies; one is loaded).
- Bad: a proxy tokenizer can pass a budget a real model would fail; the margin is unmeasured until M15 and the ADR says so.
- Bad: bumping the package or the encoding changes every count; a bump is a deliberate commit that re-runs both tests and states the new counts.

### Confirmation

M14.8 (`token-budget.test.ts` counts the catalog plus the cheat sheet), M14.19 (`token-ratio.test.ts` over `examples/dsl/`), `check-licenses` (MIT), `check-drift` (the added threshold), and the M15 amendment recording the measured margin.

## More Information

NFR-AI-002, NFR-AI-003, docs/standards/sdd.md rule 1 (UNDERIVED), ADR-0036 (a CLI token count would need its own dependency decision), research/04 §B for the token-cost comparison that motivated NFR-AI-003.
