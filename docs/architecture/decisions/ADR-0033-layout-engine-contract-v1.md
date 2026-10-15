---
status: accepted
date: 2026-10-13
decision-makers: harness (M13.2; within FR-LAY-001/007/008 and ADR-0005; no requirement changes)
---

# ADR-0033 — Layout engine contract v1: algorithms, engine, worker protocol, fingerprint

## Context and Problem Statement

`packages/layout` has the contract M12 needed (ADR-0030, ADR-0031): a pure synchronous `LayoutAlgorithm` over boxes, with `parseOptions` and `run(input, options)`, and one
algorithm, `stack`. The DSL compiler is synchronous and pure, so it calls `run` directly. M13 adds edges, containers, a worker, cancellation, a cache and an `arrange`
command (FR-LAY-001/005/007/008). 05-layout-and-routing.md §2 sketches the full interfaces; this ADR freezes the part M13 builds, and says how it relates to what exists, so
the registry, the DSL, the inspector, the CLI (M14) and packs (M17) can rely on it.

## Decision Drivers

- FR-LAY-001: algorithms are pluggable by name with typed options and one interface. FR-LAY-007: a layout never blocks the main thread and can be cancelled. FR-LAY-008: the same input and seed give the same output.
- Pure core (non-negotiable 5): `layout` has no DOM, timers, randomness, clock or `node:*`; the worker glue is isolated under `layout/worker`.
- The M12 compiler must keep working unchanged: `stack` and the `layouts` registry entry stay valid (a contract only grows).
- NFR-SIZE-005: saved files carry baked boxes and no layout code.

## Considered Options

1. **Make `run` async everywhere.** One shape for main thread and worker, but the synchronous DSL compiler (and its streaming mode) would have to become async, which changes ADR-0030's compile contract.
2. **Synchronous algorithms, an asynchronous engine around them.** Algorithms stay `run(input, options, ctx): LayoutOutput`; `LayoutEngine.run` returns a promise, runs the algorithm inline or in the worker, applies the post-passes and owns cancellation, revision and the cache. The DSL calls the algorithm (plus the same passes through a sync helper) directly.
3. **Two algorithm interfaces (`SyncLayout`, `AsyncLayout`).** Honest about the thread, but every consumer (inspector, DSL, CLI) must handle both.

## Decision Outcome

Option 2.

**Algorithm.** `LayoutAlgorithm<O>` keeps `id`, `version` and `parseOptions(raw): OptionsResult<O>` (M12) and gains `schema`, the Zod type of 05 §2, for inspector, catalog and MCP metadata: **required for every algorithm registered from M13.5 on**, and `stack` gets one in the same row. `run` becomes `run(input: LayoutInput, options: O, ctx?: LayoutCtx): LayoutOutput`, synchronous. `ctx` is `{ rng, measure, signal }`: `rng` the seeded sfc32 stream, `measure` a `TextMeasurer`, `signal` an `AbortSignal`. A built-in that ignores `ctx` stays valid, so `stack` and every M12 call site are unchanged. `capabilities` (`pins`, `compound`, `constraints`, `runsIn`) are declared; M13 reads `runsIn`. The `Promise` return, `mode`, `changed` and `onProgress` of 05 §2 are reserved for the force and constrained layouts of M17; no M13 algorithm uses them, and 05 §2 is updated to say so (M13.22).

**Input and output.** `LayoutInput` gains `edges`, `scope` (`'screen' | 'selection' | { containerId }`), and per-node `parentId` and `hints`; `constraints` stays empty until M17. `LayoutOutput` is `{ boxes, metrics?, fingerprint? }`: an algorithm returns `boxes` (and `metrics` if it knows them); the pipeline fills `metrics` and `fingerprint`, so what `LayoutEngine.run` and the synchronous pipeline return always has both (type `LaidOut = LayoutOutput & { metrics; fingerprint }`). An M12 input is a valid v1 input. Boxes are in the container's coordinates.

**Pipeline and engine.** One pure function, `layoutSync(req)`, validates options, runs the algorithm on the canonical input (below), then the post-passes in the fixed order `pins`, `overlap`, `snap` (`constraints` and `fit` are reserved), and fills `metrics` and `fingerprint`. The compiler calls it directly. `LayoutEngine.run({ input, algorithm, options?, seed?, post?, revision }, signal?)` returns a promise of the same `LaidOut`, or rejects with an `AbortError` when `signal` aborts; it adds the cache, the worker and revision handling. `tidy` and `mode: 'incremental'` are reserved for M17.

**Cancellation.** An algorithm is synchronous, so a worker busy in `run` cannot read a `{cancel}` message and `ctx.signal` cannot change mid-run. Cancellation is therefore decided by the engine, not the algorithm: on abort the promise rejects with `AbortError` at once, the host drops the job's eventual result, and, if the job is already running in the worker, the host calls `terminate()` and starts a fresh worker for the next job (the only preemption a synchronous call has). On the inline path the engine checks `signal` between the algorithm and each post-pass. Built-in algorithms have fixed iteration counts (ADR-0034), so a run is bounded; `ctx.signal` is for cooperative algorithms that M17 may add. There is no progress message in v1.

**Worker protocol** (`layout/worker`, the only place with worker glue). Main sends `{ id, revision, algId, options, input, seed, post, fontHash }` (`scope` is inside `input`), and `{ cancel, id }`, which the host turns into the `terminate()` above when the job is running and into a queue removal when it is not. The worker answers `{ done, id, output }` or `{ error, id, diagnostic }`. One job runs per scope; the host drops any result whose `revision` is older than the latest it has seen (last-write-wins). Messages are structured-clone JSON. Algorithms that run in the worker are loaded by name through `load: () => import(...)`, so `layout` does not import packs.

**Canonical input and fingerprint.** Before anything runs, the input is canonicalized by order only: nodes and edges sorted by (`order`, id) and object keys sorted. Values are never rounded on the way in, so a pinned box, a node size and the frame reach the algorithm exactly as given and the M12 compiler's output is unchanged. Rounding is the `snap` post-pass on the way out (0.5 px, ADR-0034), which skips pinned boxes. `fingerprint` = the first 128 bits, as 32 lower-case hex digits, of the SHA-256 of the canonical JSON of `{ algorithm: id@version, options, seed, input, post: pass ids with their options, fontHash }`, using the synchronous `sha256Hash128` of `@fluxion/core` (ADR-0031), so the compiler gets a fingerprint too (M13.13 amendment: 128 bits, as stable ids use, not the full digest); the asynchronous `Hasher` port is not used. `fontHash` is a field of the request (`layoutSync` and `LayoutEngine.run` both take it; empty when text is not measured): measured sizes depend on the fonts, and the caller that measured them knows the subset. Equal exact inputs give equal fingerprints; inputs that differ at all do not share one. The engine keeps a cache keyed by the fingerprint (not the compiler); a hit returns the cached output unchanged.

**Failures** are results (ADR-0144), not exceptions: `layoutSync` returns `LAYOUT_INPUT_INVALID` for a duplicate node id, a box or frame that is not finite or a negative size, `LAYOUT_OPTIONS_INVALID` when the algorithm refuses its options, `LAYOUT_FAILED` when the algorithm throws or returns a missing or non-finite box, and, in a worker, `LAYOUT_ALGORITHM_UNKNOWN` for a name the worker has not registered. Results are frozen. **Determinism** is specified in ADR-0034 (PRNG, ordering, quantization, iteration counts); this ADR only fixes where the seed and the cache enter.

### Consequences

- Good: the DSL compiler, the registry entry for `stack` and the M12 tests are untouched. One algorithm shape serves the inspector, the DSL, the CLI and packs.
- Good: cancellation, revision dropping and the cache live in one place (the engine), not in each algorithm.
- Bad: an algorithm that is slow in the main thread (dagre over several hundred nodes) can only be moved to the worker through the engine; the compiler, being synchronous, runs it inline. Large screens compile slower than they arrange.
- Bad: cancelling a running worker job terminates the worker, so the next job pays a worker start (a few tens of milliseconds); cooperative cancellation waits for the async algorithms of M17.
- Bad: the fingerprint hashes exact values, so a sub-pixel drift in a measured size is a cache miss rather than a hit; the cost is a recomputation, never a stale result.

### Confirmation

M13.5 to M13.14 tests: a test layout registers and appears in the registry, DSL resolution and the inspector picker; the same input and seed give an equal `LayoutOutput` and fingerprint; aborting a running job rejects with `AbortError` at once and a following job runs on a fresh worker; a stale revision is discarded; the compiler's pipeline and the engine give equal fingerprints for equal input; `check-layering` shows `packages/layout` pure with worker glue only under `src/worker`; the API report records the additive types.

## More Information

05-layout-and-routing.md §2, §4, §6; ADR-0005 (stack), ADR-0030 and ADR-0031 (the synchronous compiler), ADR-0034 (determinism and overlap).
