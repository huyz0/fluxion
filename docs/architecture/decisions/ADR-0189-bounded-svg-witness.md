---
status: accepted
date: 2026-10-26
decision-makers: harness (existing FR-LIB-004/NFR-SEC-001; independent architecture review, bound plan review before implementation)
---

# ADR-0189 — Canonical requests and bounded shared SVG witnesses

## Context and decision drivers

CLI and editor need one real renderer-backed positive paint port with bounded ownership. Pure batch conversion is qualified locally; production witness, font retention and commands remain separate. Preserve original artwork fidelity and security, avoid a CLI-only test port and avoid a dependency cycle with pack-import.

## Considered options

1. Reuse test screenshots as the runtime witness: useful reference evidence but requires a test host and cannot run in an ordinary editor. Rejected as the production boundary.
2. Use geometry boxes or a second SVG renderer: cheaper observation, but neither proves actual mounted artwork paint or exact fonts. Rejected.
3. Serialize actual shipped ArtworkView under explicit context into an isolated image observation, with independent source/mounted fidelity and controlled lifecycle. Chosen after the fixed feasibility checks, conditional on production qualification below. Added lifecycle/packaging code is the cost; shared browser/CLI behavior is the benefit.

## Decision outcome

Preserve prior rejected plan/review and all probe evidence. Fixed feasibility27/27 plus disabled-control3/3 passed; no production qualification. Keep ADR0187 fidelity endpoints, exact sourceDOM/mounted bounds, independent source-image/candidate-image bounds and0.1%, ordered geometry/font/context controls, diagnostic cross-path rawbounds. No threshold/retry/fixture changes.

## Tasks and dependency ownership

Backlog prerequisites are M18.83 canonical request validation (depends79), M18.84 browser witness (depends83), and M18.85 packaged Node/browser bridge (depends84). M18.80 remains full host integration/50-input3engine qualification, depends84/85; M18.16 still depends80/81. M18.81 font distribution/portable retention remains separate. No command grammar, pack publishing, rights inference or output writes in83/84. Do not mark80complete when a prerequisite passes. Each prerequisite is a separate reviewed green commit; this decision does not qualify any implementation.

M18.84: dedicated @fluxion/render browser entry, no effects on import, no Node imports, existing ArtworkView/CONTENT_CSS. Add deliberate lower-layer runtime dependency on public format request-validation helper, updating layer map/generation/package/API. Extract format's existing requestFor canonical payload/dimension/hash logic into one public validated helper shared by importer and witness; canonical fixture hashes remain identical. It validates bounded plain data, core artwork, positive natural viewport, sorted unique face metadata, normalized text-face closure and exact canonical width/height/identity. Witness rejects stale identity, noncanonical1×1 dimensions, extra/missing faces, unresolved mapped token references in captured real theme, or text family/context mismatch. Do not duplicate identity logic or silently normalize a caller's wrong request and echo its identity.

M18.85: production Node bridge in CLI/host layer, optional existing Playwright peer, shipped browser IIFE built with existing tooling from84. Locate artifact relative to installed package via import.meta.url; no repo/current-directory assumption. Launch owned BrowserServer on loopback ephemeral port, connect only to its generated endpoint, install context request blocking before page creation, set page content to trusted bundle with fixed CSP nonce and no untrusted markup interpolation; request bytes/data travel through structured evaluate transport. No network during request rendering. Existing installed Playwright types expose launchServer, close, kill and process; use owned server close then kill after1s grace, observe process exit. No unrelated process/group termination. External packed-package test directly exercises bridge outside repo, without depending on pack-import command. Missing browser/peer returns existing peer-missing diagnostic; invalid input/context, policy/capability refusal, observation deadline and cleanup failure remain distinguishable typed outcomes. Apply the same browser input/font/context ceilings before Node structured transport/serialization, with a32MiB encoded transport cap checked conservatively before encoding. The Node120s lifecycle reserves its final2s for owned-process close/kill cleanup; launch (10s max), setup and requests expire by118s. Graceful close has1s before owned-server kill; failure to observe process exit within the reserved cleanup window is a distinct cleanup failure, not success. No rerun-to-green or alternativebrowser fallback.

## Public boundaries

M18.83 exports createSvgPaintRequest(artwork, fonts) and parseSvgPaintRequest(input), both Result-returning pure format functions with Diagnostic arrays on refusal. The importer uses the same implementation; parse checks supplied identity and dimensions rather than repairing them. M18.84 exports createSvgPaintWitness from @fluxion/render/svg-witness, returning a typed Result of the owned witness session or construction diagnostics. M18.85 exports createNodeSvgPaintWitness from @fluxion/cli/svg-witness with typed transport/lifecycle failures; no command grammar is added. API reports, changesets, import fixtures and package/layer maps accompany each implementation.

## Browser API and supported profile

createSvgPaintWitness({document,theme,fonts,signal?}) returns owned {witness,dispose}; construction performs synchronous validation/snapshot and starts one lifetime timer; no DOM/font/image initialization occurs until admission. Reject invalid construction through a typed failure. One session has max128 admitted requests and120s wall-clock lifetime from successful creation. Theme is explicitly validated and frozen; font descriptors include exact bytes and face/profile metadata. Initially accept only the existing pinned Inter normal400 ASCII profile/hash; alias family may be explicit, but hash/weight/style/coverage are fixed. Unknown profile/face, conflicting family-weight-style bytes or missing text dependency is unsupported; text-free inputs require no fonts. M18.81 retains actual license/notice/bytes;84 does not infer rights or general font support.

## Policy and resource ownership

First admitted request creates an iframe with sandbox=allow-same-origin (no scripts/forms/popups/navigation capabilities). srcdoc contains CSP meta first, before any resource/markup: default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'. Then blank body only. No user data interpolated into srcdoc. Wait for that document/policy before any paint resource. Supported host CSP must permit same-origin srcdoc frame and required inline styles/data resources; inability to initialize or load is explicit unsupported, not a less-restrictive fallback.

Parent trusted code mounts React in that document, using existing nested outerSVG+ArtworkView arrangement and CONTENT_CSS/themevars. Do not mount ArtworkView directly under a .fx-el in a way that changes existing clipping. All resource-bearing objects belong to frame: document.createElement(img/canvas), frame Window FontFace constructor and frame document.fonts. XML serialization/computed-style observations use its document/Window. No parent Image/FontFace/canvas resource path. Font aliases are emitted as one quoted CSS family using CSSOM property setters and validated escaping, never unchecked stylesheet interpolation; context colors pass existing color validation and custom-property names derive only from checked token paths. DataURL is the only image source; binary exact fonts become that document's faces and validated embedded datafont declarations. No fetch/Blob fallback. Same-origin framing is not a security boundary against trusted parent code; it is style/font/resource-policy containment. Before accept, runtime capability probe verifies policy document loaded and required APIs. Test actual rejected remote image/font resources inside frame, with request observer ensuring no network request (not only parser rejection); test hostCSP refusal and cleanup.

## State machine

States idle→initializing→active→idle, and any→closing→disposed. Creation starts lifetime timer; already-aborted signal returns failure without resources. Admission validates bounded request, then claims active slot and counts toward128 (including subsequent unsupported observations); invalid requests/busy refusals do not increment or disturb active request. Deadline is min(admission+10s,creation+120s); all lazy initialization is inside it. Busy refusal affects only that call. Lifetime expiry during active work cancels it immediately, closes session, resolves unsupported. Reaching128 permits current request within deadline, then closes.

Abort/dispose/deadline advances generation before cleanup. Every continuation checks generation BEFORE creating/attaching resources and before returning a receipt. Keep per-request owned resource cleanup list, registered at creation, and remove font/image/canvas/React/iframe resources on all exit paths. No late callback can attach or publish. Dispose idempotent; calls after disposed refuse. Tests explicitly cover expired-before-admission, expiry-mid-fontload, abort-mid-decode, initialization failure, concurrent refusal preserving first request,128th completion,129th refusal and late completion after dispose. Timers cannot interrupt synchronous JS; bounded inputs/traversal limit that work, and no hard process-memory/time claim is made.

## Allocation ceilings

Inspect counts/byteLength before copies: ≤8faces, aggregatefontbytes≤8MiB; reject detached/invalid buffers. Bounded plain-data traversal with cycle detection before cloning: request uses existing SVG depth/node/string limits and its unchanged aggregate input-character cap; theme≤4096nodes, depth32, aggregate256KiB text. No stringify before these checks. Validate then make owning copies, including Buffer-compatible Uint8Array copy.

Before serialization compute conservative markup upper bound from bounded nodes/attribute/text lengths using worst-case XML escaping plus fixed wrappers/style/context and 4*ceil(fontBytes/3) datafont size. Reject predictedUTF8>16MiB before XMLSerializer/base64. Exact UTF8/serialized caps checked afterward too. Encode base64 in bounded chunks, not spread over whole array. Keep one decodedImage and one1024²canvas/readback at a time; scan each backdrop immediately and retain only bounds/status, release readback before next. Disabled control is second serialization with actual child artwork removed; never rootdisplay:none. At most original/disabled bounded strings and current dataURL live; reset image src, zero canvas, remove handlers in finally. These are enforceable input/allocation ceilings with conservative working-set rationale, not a claimed exact RAM ceiling. Caller-owned input memory is outside ownership; prechecks prevent duplicating oversized buffers.

## Confirmation and completion

83 tests shared request construction/parsing, unchanged golden hashes, exact raster dimensions, bounded/cyclic inputs and normalized font closure. 84 tests context refusal; actual owned-font boundary; structural/text-context validator; uniformdisabledcontrols; no-paint/clipping/subpixel/token/currentColor; stale/consecutive requests; lifecycle transitions; actual frameCSP network controls; import-safe main/SSR/browserentries. Live adapter tests compare actual isolated mount mappings against existing ScreenView and pinned corpus feasibilitycases, unchanged limits.

85 tests production packaged bridge outside repo, real browser process cleanup/timeout/missingpeer, no network, exactsame browser entry, deterministic bounded results and transport caps. Test CLIhost on installedpackage, not a test-only screenshot port. AutomaticCI runs all required OS checks.

80 then runs full original50×3 engines through shipped browser adapter and actual Node bridge/editor-side consumer, old sourceDOM/mounted controls plus accepted candidatecontrols, supported CSP configuration, fontbytes/coverage/textcontrols and cleanup. Request dimensions fixed, zero retries. Any new failure remains blocking and preserved. Independent code review and local verification precede each ordinary push; no release/deployment.

## Consequences and references

This clarifies ADR-0187 qualification endpoints; it does not relax its original-source/mounted exact bounds, pixel threshold, font or negative-control obligations. Cross-path raw bounds remain diagnostic evidence; all failed probes stay failed. The initial pinned font profile is deliberately narrow and unsupported capabilities refuse explicitly. Node bridge owns only its launched browser; there is no release/deployment or remote service. ADR-0187, ADR-0188, ADR-0176 and architecture01 are retained. Verification of the actual iframe and installed artifact cannot be replaced by the earlier27case feasibility result.
