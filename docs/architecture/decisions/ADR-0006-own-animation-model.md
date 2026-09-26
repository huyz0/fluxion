---
status: accepted
date: 2026-09-26
decision-makers: Fluxion maintainers
---

# ADR-0006 — Own declarative animation model and scheduler; state = sample(model, t)

## Context and Problem Statement

Fluxion needs builds, entrance/exit/emphasis effects, transitions and magic move, morphs, connector
flows and riders (FR-ANI, FR-TML, FR-TRN, FR-MRP, FR-FLW, FR-RDR). The results must be
AI-generatable, scrubbable in the editor (FR-ANI-011), reversible and deep-linkable (FR-TML-002/005),
exportable to PDF and video, and fast on mid-range mobile (NFR-PERF-004). Should a third-party
animation library's model be our model?

## Decision Drivers

- The animation data is part of the file format: JSON, validated, versioned, licence-free.
- Determinism: any `(screen, step, t)` renders exactly (edit scrub, speaker sync, export).
- Performance: compositor-friendly properties off the main thread; hundreds of riders.
- Player size (NFR-SIZE-001) and licence constraints (NFR-LIC-002).
- Reduced motion and flash safety (NFR-A11Y-003).

## Considered Options

1. GSAP as engine and model
2. Motion (motion/react) as engine and model
3. Lottie/Rive as the animation format
4. Own JSON model + own scheduler with thin backends (WAAPI, rAF sampler, canvas riders)

## Decision Outcome

Chosen option: **4**. `@fluxion/anim` defines the declarative model (effects, steps, sequences,
triggers, riders, morph specs; times in ms; presets plus parameters) and pure evaluation: step
compilation, build-state reduction and `sample(model, t)`. The clock is injected. The `player`
scheduler delegates tweening:
- compositor properties go to **WAAPI** (paused animations, driven by `currentTime`);
- SVG attributes (`d`, dash offset, colors) go to one rAF sampler;
- riders use arc-length LUTs with CSS `offset-path`, or a canvas layer beyond a threshold.

Helpers: **flubber** (shape morph), **d3-interpolate-path** (route morph), and our own FLIP magic
move driven by model geometry. **Motion** is used only for editor/player chrome UI. GSAP stays out
of core (licence clause risk). Lottie and Rive are optional media plugins, not the model.

### Consequences

- Good, because the editor preview uses the same scheduler with a controlled clock — WYSIWYG motion.
- Good, because `seek(step, t)` powers prev, deep links, speaker view, thumbnails and PDF/video.
- Good, because the model is small and easy for AI to generate (presets with defaults).
- Bad, because we maintain effect primitives, easing (cubic-bezier + CSS `linear()` for springs),
  and the per-backend drivers.
- Bad, because WAAPI on SVG differs across engines, so benchmarks decide promotion strategies.

### Confirmation

Determinism tests (sample twice, compare). Reverse-step property test (`prev` restores the exact
prior state). Performance traces on animation fixtures at 4× CPU throttle (NFR-PERF-004). Rider
benchmark (FR-RDR-005). Reduced-motion E2E test.

## Pros and Cons of the Options

| Option | Pros | Cons |
|---|---|---|
| GSAP | quality ceiling, MorphSVG free | licence clause against competing no-code builders; its object model would become our format |
| Motion | great React UI motion | not a document timeline model; component-bound |
| Lottie/Rive | designer tooling | assets, not editable diagram semantics; WASM runtimes |
| Own model + thin backends | deterministic, small, licence-free, AI-friendly | engineering effort |

## More Information

Research: `docs/research/03-animation-interaction-presentation.md` §0, §1.3, §9. Architecture:
`../07-animation-and-interaction.md`.
