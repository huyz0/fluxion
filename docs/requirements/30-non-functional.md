# 30 — Non-Functional Requirements

Areas: `PERF`, `SIZE`, `PORT` (portability/compat), `REL` (reliability), `SEC`, `A11Y`, `I18N`,
`MNT` (maintainability), `EXT` (extensibility quality), `AI` (AI-quality), `OBS` (observability),
`DX` (developer experience), `LIC` (licensing).

Every NFR names **how it is measured**. Numeric thresholds live as constants in
`scripts/gates/thresholds.mjs` and may only move in the strengthening direction (see
`../standards/testing.md`). "Reference desktop" = 4-core laptop CPU (≈ 2022 i5/M1) with Chrome
stable; "reference mobile" = mid-range Android (≈ Pixel 6a / Moto G-class 2023), emulated in CI
via 4× CPU throttling.

## PERF — Performance

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-PERF-001 | M | R1 | Editor interaction (drag/resize) of 1 element on a screen with 500 elements ≥ 55 fps on reference desktop. | Playwright perf trace, CI perf job. |
| NFR-PERF-002 | M | R3 | Screen with 2,000 elements + 1,000 connectors: pan/zoom ≥ 50 fps, initial render < 1 s. | Perf benchmark fixture. |
| NFR-PERF-003 | M | R1 | Open a 50-screen document (no photos) and show first screen < 1.5 s on reference desktop, < 3 s on reference mobile. | Lighthouse/Playwright timing. |
| NFR-PERF-004 | M | R4 | Present-mode animations ≥ 58 fps desktop, ≥ 55 fps mobile for standard effects; no long task > 50 ms during transitions. | Perf trace on animation fixtures. |
| NFR-PERF-005 | M | R2 | Layout: 100-node layered layout < 200 ms; 500-node < 2 s (worker); routing of 200 orthogonal connectors < 300 ms. | vitest bench with regression budget ±15 %. |
| NFR-PERF-006 | M | R0 | Undo/redo of any single command < 16 ms for documents ≤ 5,000 records. | Benchmark. |
| NFR-PERF-007 | S | R8 | Memory: 50-screen document in editor < 300 MB JS heap. | Heap snapshot in CI perf job. |
| NFR-PERF-008 | M | R4 | Off-screen screens and hidden tabs consume ~0 CPU (ambient animations paused, rAF stopped). | Perf test: CPU time over 10 s hidden < 1 %. |

## SIZE — Bundle & file size

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-SIZE-001 | M | R1 | Player core bundle ≤ 150 kB gzip (React included); heavy features (layout engines, morph, Lottie, routing wasm) lazy-loaded chunks. | size-limit in CI. |
| NFR-SIZE-002 | M | R1 | Editor initial bundle ≤ 600 kB gzip; time-to-interactive < 2.5 s on reference desktop. | size-limit + Lighthouse. |
| NFR-SIZE-003 | M | R1 | Typical 20-screen document without photos: `.flux` ≤ 150 kB; `.flux.html` ≤ 450 kB gzip (incl. player; ADR-0157). | Fixture size test. |
| NFR-SIZE-004 | M | R1 | Save embeds only used: shape definitions, fonts (subset when enabled), plugin player bundles, assets (deduped). | Fixture test comparing embedded vs referenced. |
| NFR-SIZE-005 | S | R2 | Layout engines are **not** embedded in the saved file unless live-layout containers require them; otherwise computed positions are baked. | Fixture: static doc file contains no ELK chunk. |

## PORT — Portability & compatibility

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-PORT-001 | M | R1 | Browsers: Chrome/Edge, Firefox, Safari (macOS & iOS) — current and previous major; Android Chrome. | Playwright matrix (chromium, firefox, webkit). |
| NFR-PORT-002 | M | R1 | `.flux.html` works opened from `file://`, from any static host, and offline; no external network requests unless explicitly allowed. | E2E with network blocked, file:// protocol. |
| NFR-PORT-003 | M | R1 | File format forward/backward policy: newer app opens all older files (migrations); older app opens newer minor-version files with unknown fields preserved; major version bump only with converter. | Migration fixture suite. |
| NFR-PORT-004 | M | R2 | CLI & headless libraries run on Node ≥ 22 LTS on Windows, macOS, Linux. | CI OS matrix. |
| NFR-PORT-005 | M | R0 | Development works on Windows, macOS, Linux (no bash-only scripts in the required path; Node scripts). | CI OS matrix for gates. |
| NFR-PORT-006 | S | R8 | Deterministic rendering across platforms: same doc → pixel-diff ≤ 0.5 % between Chromium on Linux/Windows/macOS with embedded fonts. | Visual regression cross-OS job (nightly). |

## REL — Reliability & data safety

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-REL-001 | M | R1 | No data loss: autosave interval ≤ 5 s after changes; save is atomic (write temp then swap where FS API allows). | Crash-injection E2E. |
| NFR-REL-002 | M | R0 | Loading never throws uncaught: invalid input → structured error + salvage. | Fuzz test (fast-check) on loader with 10k random/corrupted inputs. |
| NFR-REL-003 | M | R0 | Undo history consistency: any sequence of commands followed by full undo restores the initial document exactly. | Property test. |
| NFR-REL-004 | M | R6 | Plugin/component failure isolated (error boundaries, sandbox); editor never white-screens. | Fault-injection tests. |
| NFR-REL-005 | M | R0 | Deterministic core: document operations, layout, routing, animation sampling are pure/deterministic given input+seed+clock. | Snapshot determinism tests run twice. |

## SEC — Security & privacy

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-SEC-001 | M | R1 | Treat every opened file as untrusted: sanitize SVG/HTML/rich text (no script, no event handlers, no external refs unless allowed); no `eval`/`new Function` on document data. | Security test corpus (XSS payloads) in CI; lint bans `eval`. |
| NFR-SEC-002 | M | R1 | `.flux.html` ships a strict Content-Security-Policy (no remote script, restricted connect-src) compatible with embedded plugins via hashes. | CSP test: remote fetch blocked. |
| NFR-SEC-003 | M | R6 | Untrusted plugin code runs sandboxed (iframe `sandbox`, separate origin where possible) and communicates via a typed message protocol; permissions declared in manifest and granted by user. | Security E2E: sandbox cannot read parent DOM, storage, or cookies. |
| NFR-SEC-004 | M | R2 | AI provider keys stored only in local browser storage (optionally encrypted), never written into documents, logs or telemetry. | Test scans saved files & logs for key patterns. |
| NFR-SEC-005 | M | R0 | Supply chain: lockfile committed, dependency review on PR, OSV/audit scan in CI, pinned GitHub Actions by SHA, npm provenance for published packages. | CI jobs. |
| NFR-SEC-006 | M | R1 | No telemetry by default; optional, opt-in, anonymous, documented. | Code review + network test. |
| NFR-SEC-007 | S | R6 | Expression language for bindings/conditions is a safe interpreter with CPU/time limits. | Fuzz + DoS tests (infinite loop inputs terminate). |

## A11Y — Accessibility

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-A11Y-001 | M | R1 | Editor UI conforms to WCAG 2.2 AA (keyboard operable, focus visible, labels, contrast). | axe-core in Playwright (0 serious/critical), manual checklist per release. |
| NFR-A11Y-002 | M | R1 | Player: each screen exposes a semantic structure (headings, lists, alt text, connector relationships as text "A connects to B: label"); screen changes announced (live region). | Screen-reader smoke tests (NVDA/VoiceOver checklist) + axe. |
| NFR-A11Y-003 | M | R4 | `prefers-reduced-motion` honored; no content flashes > 3 per second. | E2E + flash lint on effects. |
| NFR-A11Y-004 | M | R1 | Full keyboard navigation in present mode incl. interactive elements and popups (focus trap/restore). | Keyboard E2E. |
| NFR-A11Y-005 | S | R3 | Contrast linter warns on theme/element combos below WCAG AA. | Unit tests. |
| NFR-A11Y-006 | S | R2 | AI generation includes alt text and reading order by default. | Eval metric. |

## I18N — Internationalization

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-I18N-001 | M | R1 | All UI strings externalized (ICU message format); English default. | Lint rule: no string literals in JSX UI of editor (allowlist). |
| NFR-I18N-002 | S | R8 | Ship ≥ 3 UI locales (en, vi, es) and RTL UI support. | Visual tests in each locale. |
| NFR-I18N-003 | M | R8 | Document content supports any Unicode script (see FR-TXT-006). | Fixtures. |

## MNT — Maintainability & architecture quality

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-MNT-001 | M | R0 | Layered architecture enforced: `schema` ← `core` ← (`layout`,`routing`,`anim`) ← `render` ← (`player`,`editor`) ← apps; core packages are **pure** (no DOM, no timers, no network). | dependency-cruiser gate. |
| NFR-MNT-002 | M | R0 | TypeScript strict (incl. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); no `any` except in allowlisted adapters. | tsc + lint gate. |
| NFR-MNT-003 | M | R0 | Size limits: file ≤ 400 lines (soft 300), function ≤ 60 lines, cyclomatic complexity ≤ 12. | Lint + check-size gate. |
| NFR-MNT-004 | M | R0 | Test coverage floors: core/schema/layout/routing/anim ≥ 90 % lines & ≥ 85 % branches; render/player ≥ 80 %; editor ≥ 70 % + E2E flows. | Coverage gate; floors only rise. |
| NFR-MNT-005 | S | R3 | Mutation score floors (tzap; ADR-0146) for core, schema, layout, routing ≥ 70 %. | Nightly mutation job. |
| NFR-MNT-006 | M | R0 | CRDT-ready model (see FR-DOC-010): operations expressible as record-level puts/deletes. | Architecture test: every command emits record diffs only. |
| NFR-MNT-007 | M | R0 | Public APIs documented (TSDoc) with API reports; breaking changes require changeset `major` + ADR. | API Extractor gate. |
| NFR-MNT-008 | M | R0 | Every requirement traceable to tests (ID in test title) and milestone tasks. | `check-trace` gate. |

## AI — AI-quality attributes

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-AI-001 | M | R2 | Generated documents validate one-shot ≥ 90 %, after one repair round ≥ 99 % on the eval set (reference model: current Claude Sonnet-class). | `pnpm eval` scorecard (recorded + live nightly). |
| NFR-AI-002 | M | R2 | AI catalog + authoring guide fit in ≤ 8k tokens for the core packs (scalable with per-pack detail on demand). | Token count test. |
| NFR-AI-003 | M | R2 | DSL is ≥ 3× more token-efficient than canonical JSON for the same document. | Measured on example corpus. |
| NFR-AI-004 | S | R2 | Lint quality score for generated decks ≥ 85/100 average on eval set. | Eval scorecard. |

## OBS — Observability & diagnostics

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-OBS-001 | M | R1 | Structured, leveled logging (dev console) with namespaces; debug overlay (FPS, render counts, layout timings) toggle. | Manual + unit tests on logger. |
| NFR-OBS-002 | S | R1 | "Copy diagnostic report" (versions, doc stats, errors — no content) for bug reports. | Unit test ensures no document text included. |

## DX — Developer experience (humans & AI agents)

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-DX-001 | M | R0 | Fresh clone → `pnpm i && pnpm run setup && pnpm verify` green in < 10 min (`pnpm setup` is a pnpm built-in, hence `run`: ADR-0138) on reference machine. | CI job measuring cold setup. |
| NFR-DX-002 | M | R0 | Quick gate (typecheck changed + lint changed + related tests) < 30 s; full pre-commit gate < 120 s. | check-budget gate. |
| NFR-DX-003 | M | R0 | AI harness works identically from Claude Code and Codex (same skills, same scripts). | check-portability gate + adapter tests + harness test suite (dry-run doc optional, ADR-0137). |
| NFR-DX-004 | M | R0 | Zero flaky tests policy: a flaky test is quarantined within 24 h with a backlog row; CI retries disabled for unit tests. | CI config + flake tracker. |

## LIC — Licensing

| ID | Pri | Inc | Requirement | Measurement |
|---|---|---|---|---|
| NFR-LIC-001 | M | R0 | Fluxion source licensed MIT (packages) — player runtime embeddable in any file without copyleft obligations. | LICENSE present; license gate. |
| NFR-LIC-002 | M | R0 | Dependencies in the player/editor: permissive licenses only (MIT, Apache-2.0, BSD, ISC, MPL-2.0 file-level OK). EPL/LGPL components (elkjs, libavoid-js) only as **optional, separately loaded, unmodified** modules with notices. No dependency requiring domain-locked keys or watermarks. | `license-checker` gate with allowlist. |
| NFR-LIC-003 | M | R3 | Shape/icon packs record license & attribution; brand icon packs (cloud providers) follow vendor usage rules; attributions embedded in files that use them. | Pack schema requires license field; gate. |
