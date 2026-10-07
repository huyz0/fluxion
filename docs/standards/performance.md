# Performance

> Read when: touching a hot path (render, overlay, layout, routing, anim sampling, store,
> undo); adding a dependency to `player` or the editor entry; adding or changing a benchmark;
> profiling a slowdown.
> Family: Quality · Related: [tech-stack.md](tech-stack.md), [code-structure.md](code-structure.md),
> `docs/requirements/30-non-functional.md` (PERF, SIZE).

Budgets are product requirements, not aspirations. Every number below lives once in
`scripts/gates/thresholds.mjs`; this file explains them. Thresholds only move in the
strengthening direction. → `check-drift`

## 1. Budgets

| ID | Budget | Measured by |
|---|---|---|
| NFR-PERF-001 | Drag 1 of 500 elements ≥ 55 fps (desktop) | Playwright perf trace |
| NFR-PERF-002 | 2,000 elements + 1,000 connectors: pan/zoom ≥ 50 fps, first render < 1 s | perf fixture |
| NFR-PERF-003 | Open 50-screen doc, first screen < 1.5 s desktop / < 3 s mobile | Playwright timing |
| NFR-PERF-004 | Present animations ≥ 58 fps desktop / ≥ 55 mobile; no long task > 50 ms in transitions | perf trace |
| NFR-PERF-005 | Layered layout 100 nodes < 200 ms, 500 nodes < 2 s (worker); route 200 orthogonal connectors < 300 ms | vitest bench |
| NFR-PERF-006 | Undo/redo any single command < 16 ms (≤ 5,000 records) | vitest bench |
| NFR-PERF-007 | 50-screen doc in editor < 300 MB JS heap | heap snapshot |
| NFR-PERF-008 | Hidden tab / off-screen screens < 1 % CPU over 10 s | perf test |
| NFR-SIZE-001 | Player core ≤ 150 kB gzip (React included) | size-limit |
| NFR-SIZE-002 | Editor initial ≤ 600 kB gzip; TTI < 2.5 s | size-limit + Lighthouse |
| NFR-SIZE-003 | 20-screen doc: `.flux` ≤ 150 kB, `.flux.html` ≤ 450 kB gzip | fixture size test |
| NFR-DX-002 | Quick gate < 120 s (ADR-0161); pre-commit gate < 480 s (ADR-0163) | `check-budget` |

"Desktop" = 4-core ≈2022 laptop, Chrome stable. "Mobile" = 4× CPU throttling in CI.

## 2. Rendering rules

1. **Animate only compositor properties** — `transform`, `opacity` (and `filter` only where
   measured). Never animate `top/left/width/height`, `box-shadow`, or SVG geometry attributes
   per frame when a transform works. → review + perf trace on animation fixtures
2. **Use WAAPI for compositor effects**; the `anim` scheduler samples only what can't be
   expressed there (morphs, path interpolation, riders). → review
3. **No layout thrash**: never read layout (`getBoundingClientRect`, `offsetWidth`,
   `getBBox`) after writing styles in the same frame. Batch reads, then writes; measurement goes
   through the `TextMeasurer` port with caching. → review + "Forced reflow" check in perf trace

```ts
// ❌ read-write-read per element
for (const el of els) { el.style.width = w(el) + "px"; heights.push(el.offsetHeight); }
// ✅ read all, then write all (or measure via TextMeasurer, cached per font+text)
const hs = els.map((el) => el.offsetHeight);
els.forEach((el, i) => { el.style.width = w(el, hs[i]) + "px"; });
```

4. **Cull off-screen elements**: outside the viewport → `display: none` (kept mounted if
   stateful) or unmounted if the kind allows. → perf fixture NFR-PERF-002
5. **Spatial index for every spatial query**: `rbush` while editing, `flatbush` for present and
   export. No O(n) scans for hit-testing, brush selection, snapping or obstacle lists. → bench
   `hit-test-2000`
6. **Hit-testing is geometric**, not DOM-based (`elementFromPoint` is not used on the canvas). →
   review
7. **Signals granularity = one per record**; components subscribe to the smallest derived value
   they render. Dragging one shape re-renders that shape and the overlay, nothing else. → render
   count test (`render-counts.browser.test.ts`) using the debug overlay counters
8. **No store-wide subscriptions in React** (`useValue(doc$)` is banned outside tests). → review
9. **Heavy computation runs in workers**: layout > 100 nodes, routing > 50 connectors, zip/unzip
   of large files, font subsetting. Worker glue is isolated (`layout/worker`); the pure algorithm
   stays testable in Node. → review + bench budgets
10. **Stop work nobody sees**: pause rAF, ambient animations and timers when the tab is hidden or
    the screen is off-screen. → NFR-PERF-008 perf test
11. **Lazy-load heavy features**: layout engines, morph, Lottie, routing wasm, AI panel, exporters
    are separate chunks, loaded on first use. → size-limit (player/editor entry budgets)

## 3. Data and algorithm rules

12. **Undo is record-diff based**; never snapshot the whole document per step. → NFR-PERF-006
    bench
13. **Memoise derived data in `computed`**, not in ad-hoc caches; invalidation follows signal
    dependencies. → review
14. **Avoid allocation in per-frame paths**: reuse vectors/matrices in `geometry` hot loops; no
    array spread or `map/filter` chains inside the rAF tick. → bench
15. **Hand-memoisation in React (`useMemo`, `memo`) needs a profile** in the PR; React Compiler
    covers the rest. → review

## 4. Measuring

| What | Tool | Where |
|---|---|---|
| Pure algorithms (layout, routing, geometry, undo, sampling) | `vitest bench` (Vitest 5 bench fixtures) | `packages/*/bench/*.bench.ts` |
| Frame rate, long tasks, forced reflows | Playwright + CDP tracing, 4× CPU throttling for mobile | `e2e/perf/*.perf.ts` |
| Bundle size | size-limit (gzip), per entry | `.size-limit.json` |
| File size | fixture tests | `packages/format/src/__fixtures__` |
| Memory | `performance.measureUserAgentSpecificMemory` / heap snapshot in perf job | perf job |
| Render counts | debug overlay counters (NFR-OBS-001) | browser tests |

16. **Benchmarks use fixed fixtures and seeds** (`examples/perf/*.flux.json`, injected `Random`).
    → bench fails without a fixture
17. **Every budget in §1 has an automated measurement.** A new hot path adds a bench in the
    same PR. → `check-trace` (NFR IDs in bench/test titles)

## 5. Regression policy

18. **Benchmarks may not regress more than 15 %** against the stored baseline
    (`scripts/gates/perf-baseline.json`); size-limit entries may not exceed their budget at all. →
    `pnpm verify` (bench compare) + size-limit
19. **Baselines are updated only by improvements** or with an ADR that justifies a new cost. →
    `check-drift`
20. **Frame-rate and timing tests run in CI perf job on a fixed runner**; local numbers are for
    investigation, not for arguing with the gate. → CI `perf` job
21. **An optimisation lands with its numbers** (before/after in the PR description). → review

## 6. Profiling how-to

1. Reproduce with a fixture: `pnpm bench --filter @fluxion/routing` or
   `pnpm test:perf -g "drag 500"`.
2. For browser paths, record a trace: `pnpm test:perf --trace on`, then
   `npx playwright show-trace test-results/**/trace.zip`, or Chrome DevTools Performance panel with
   4× CPU throttling and "Screenshots" on.
3. Look for, in order: long tasks > 50 ms, forced reflow warnings, React commits touching many
   components (React DevTools Profiler, "Highlight updates"), GC sawtooth (allocation in hot path).
4. For pure code, profile in Node: `node --cpu-prof` on the bench, open the `.cpuprofile` in
   DevTools.
5. Toggle the debug overlay (`Ctrl+Alt+Shift+D`) for FPS, render counts and layout timings.
6. Fix, re-run the same bench/trace, paste before/after into the PR.
