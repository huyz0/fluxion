# 03 — Animation, Interaction & Presentation Runtime

> Status: Research input · Date: 2026-09-26 · Scope: animation engines, path morphing, path-following
> riders, serializable timeline/interaction model, presentation-framework ideas, a11y, mobile performance.
> Vocabulary follows `00-product-analysis.md` (Screen, Element, Connector, Rider, Timeline/Build,
> Interaction, Mode, Player).

---

## 0. TL;DR

- **One timeline engine we own, thin adapters underneath.** Fluxion's animation data must be a
  declarative JSON model (AI-generatable, editor-scrubbable, deterministic). No third-party library's
  object model should *be* our file format. We build a small **Timeline Scheduler** that evaluates our
  model and delegates the per-property "tweening" to the cheapest backend that can do it:
  **WAAPI** (compositor-friendly: transform/opacity/offset-distance/filter), **our own rAF sampler**
  (SVG attributes like `d`, `stroke-dashoffset`, colors on SVG, rider positions on canvas).
- **Motion (motion/react)** for React-component-level UI animation: popups, overlays, `AnimatePresence`,
  and `layoutId` shared-element transitions inside the Player chrome and in user "component shapes".
- **Screen transitions:** own FLIP/"magic move" implementation driven by element ids (we already
  have full geometry in the model, so we don't need DOM measurement), with **View Transitions API**
  as an optional progressive enhancement for DOM-heavy screens (same-document VT is now in all
  engines; element-scoped VT in Chrome 147+).
- **Path morphing:** **flubber** (MIT, handles different point counts/subpaths) for arbitrary shapes,
  plus a fast path for "compatible" paths (same command structure → direct numeric lerp). Precompute
  interpolators at screen-load, cache sampled frames for mobile.
- **Riders along connectors:** SVG `getPointAtLength` → precomputed **arc-length lookup table
  (LUT)**; ≤ ~50 riders render as SVG/DOM with CSS `offset-path` + WAAPI on `offset-distance`
  (compositor), more than that → a **canvas overlay layer** (2D, OffscreenCanvas worker where available).
- **GSAP** is now 100% free incl. MorphSVG/DrawSVG/MotionPath (Webflow, 2025) — a legitimate
  alternative backend, but its "no competing no-code builder" license clause is a risk for a
  visual editor product; keep it *optional/plugin-only*, not core (see §1.3).
- **Lottie (dotLottie) and Rive** are *assets*, embedded via a `media` element with a pluggable
  player; not our animation model. Both runtimes use WASM → base64-inline cost for single-file output.
- **Interaction:** Figma-style **trigger → (conditional) actions** rules + **per-screen state
  machine** (XState-like but serialized as plain JSON; don't ship XState in the Player unless needed).
- **Presenter:** BroadcastChannel dual-window speaker view (offline, same origin), optional WebRTC/
  relay remote, laser pointer & ink as overlay layers that never mutate the document.

---

## 1. Animation engines (2025–2026 state)

### 1.1 Comparison table

| Engine | Size (min+gz, approx.) | Model | Strengths for Fluxion | Weaknesses / risks | License |
|---|---|---|---|---|---|
| **Motion** (`motion`, ex-Framer Motion) v12 | full `motion` component ~30–34 KB; `LazyMotion`+`m` ~4.6 KB initial; `animate` mini ~2.3 KB | React declarative props (`initial/animate/exit`), variants, springs, `layout`/`layoutId`, `AnimatePresence`, gestures; vanilla `animate()` hybrid WAAPI engine; `animateView` (View Transitions wrapper, React 19.3+ `AnimateView`) | Best-in-class React DX; layout/shared-element transitions for DOM; spring physics; interruption handling; hardware-accelerated via WAAPI where possible | Layout animation measures DOM (FLIP) — not ideal for thousands of SVG nodes; timeline sequencing (`animate([...sequence])`) exists but no scrubbable global timeline object model; path morph needs flubber | MIT (Motion+ paid extras = examples/premium components, not core) |
| **GSAP 3** (+ ScrollTrigger, Flip, MorphSVG, DrawSVG, MotionPath, SplitText…) | core ~25 KB; each plugin 3–10 KB | Imperative tweens + nested `gsap.timeline()` with labels, position params (`"<"`, `"+=0.5"`), seek/scrub/reverse | Most complete timeline (seek/progress/timeScale ideal for edit-mode scrubbing), MorphSVG (point-count matching, shapeIndex), DrawSVG, MotionPath (autoRotate, align), Flip plugin (magic move), battle-tested on mobile | Imperative, not a data model; bundle adds up with plugins; **license**: GSAP "Standard 'No Charge' License" is free incl. commercial use and all plugins since Apr 2025, but it prohibits use in products that compete with Webflow (visual website builders). Fluxion's static-site output + visual editor must get legal review before making GSAP core | Proprietary "no charge" license (not OSI) |
| **anime.js v4** (2025 rewrite) | modular ESM; core ~10 KB, tree-shakable | `animate()`, `createTimeline()`, `createTimer`, `svg.morphTo()`, `svg.createDrawable()`, `svg.createMotionPath()`, `waapi.animate()` bridge, draggable, scope | Small, MIT, has *all three* SVG features we need (morph/draw/motion path) and a real timeline with seek; v4 has a WAAPI-backed mode | `morphTo` interpolates point lists (works best for similar shapes; less robust than flubber/MorphSVG for wildly different topologies); smaller ecosystem than GSAP/Motion | MIT |
| **Web Animations API (WAAPI)** | 0 KB (native) | `el.animate(keyframes, timing)`, `Animation` objects with `currentTime`, `playbackRate`, `finished`, `commitStyles`, `GroupEffect` still not shipped | Runs transform/opacity/filter(partly)/`offset-distance` on the compositor → survives main-thread jank; scrubbable via `currentTime` (perfect for edit-mode preview); zero bundle | Cannot animate SVG attributes that aren't CSS properties (e.g. `d` is a CSS property in Chromium/Firefox but not Safari; `points` no); no built-in springs (use `linear()` easing to encode spring curves — supported in all engines since 2023/24); no group/sequence primitive | Web standard |
| **CSS Motion Path** (`offset-path`, `offset-distance`, `offset-rotate`, `offset-anchor`) | 0 KB | CSS; `path()`, `url(#id)`, `ray()`, basic shapes | Riders along connectors with auto-rotate; compositor-animated when simple; baseline across Chrome/Firefox/Safari | `path()` coordinates are in the element's containing block px (not SVG viewBox units) — must rescale path strings on zoom/resize or place riders inside a same-scale layer; `url()` references not uniformly supported | Web standard |
| **View Transitions API** | 0 KB | `document.startViewTransition(cb)`; `view-transition-name`; pseudo-element tree animated via CSS/WAAPI | Native "magic move" of DOM snapshots across state changes; same-document VT in Chrome 111+, Safari 18+, Firefox 144+; cross-document VT in Chrome 126+/Safari 18.2+ (not Firefox stable); **element-scoped VT** (`element.startViewTransition`) in Chrome 147 (Mar 2026) allows concurrent/nested transitions; React `<ViewTransition>` stable in React 19.3 (Sep 2026) | Snapshots are bitmaps: text/SVG scales as image during transition (blurry at big zooms), no true path morph; pointer events blocked during transition (document scope); inconsistent in edit mode; Firefox cross-doc missing — irrelevant for us (single file ⇒ same-document only) | Web standard |
| **React Spring** v10 | ~20 KB | Spring-physics hooks (`useSpring`, `useTransition`, `useChain`) | Physics-y feel, active maintenance (v10 2025) | Overlaps Motion; no timeline authoring model | MIT |
| **Popmotion** | — | Low-level tween/spring functions | Historical; Motion absorbed its ideas | **Unmaintained** — avoid | MIT |
| **Lottie / dotLottie** | lottie-web ~75 KB gz (full SVG/canvas); `@lottiefiles/dotlottie-web` uses WASM (ThorVG) renderer | JSON (Bodymovin) animation exported from After Effects/LottieCreator; `.lottie` zip container with multiple animations, themes, and (since late 2025) **state machines** | Designer-made rich vector animations as *assets*; open spec now stewarded by the Lottie Animation Community (LF) | Not an authoring model for our shapes; WASM must be base64-inlined for single-file offline; JSON files can be large | MIT runtimes; spec open |
| **Rive** | runtime WASM (canvas/WebGL2 variants), several hundred KB | `.riv` binary; artboards, animations, **state machines** with inputs (bool/number/trigger), data binding | Best for interactive vector assets (hover/press states, game-like UI) with tiny asset files | Proprietary editor; runtime size; asset-only | MIT runtimes |
| **Theatre.js** | core ~? (studio is large, dev-only) | Project state JSON: projects → sheets → objects → props with keyframed sequences; studio UI edits state | Proves the "JSON project state + scrubbable sequence editor" idea; excellent reference for our timeline editor UX (sequence editor, curve editor, keyframe tracks) | Road to 1.0 slow, community asked "will it continue?" (issue #504); coupling risk; AGPL for studio historically → don't depend, borrow concepts | Apache-2.0 core / AGPL-3.0 studio |

### 1.2 Key observations

1. **Nobody's object model fits our file format.** All engines (GSAP, anime, Motion) are runtime APIs.
   Theatre.js and Lottie are the only ones with a *serialized* model; Theatre's is closest in spirit
   (tracks per property, keyframes, sequences) but has no triggers/builds; Lottie's is After-Effects
   shaped (layers/precomps, per-property keyframes with bezier tangents `i/o`) and far too verbose
   for AI generation.
2. **Scrubbing is the killer requirement for edit-mode preview.** Whatever runs in Present mode must be
   seekable to an arbitrary time/step in Edit mode deterministically. That favors (a) WAAPI
   `Animation.currentTime`, (b) pure functions `value = f(t)` evaluated by our sampler, and rules out
   "fire-and-forget" physics springs unless we pre-bake springs to `linear()` easing or sampled curves.
3. **Compositor vs attribute animation split.** transform/opacity/`offset-distance`(simple)/some
   filters run off-main-thread via WAAPI. SVG-specific things (`d`, `stroke-dashoffset`, fill on SVG
   children, gradients) generally are main-thread paints. On mobile, budget main-thread animations
   tightly (see §8).
4. **GSAP licensing nuance.** GSAP became free for everyone (incl. formerly bonus plugins) in 2025
   after Webflow's Oct 2024 acquisition of GreenSock. The standard license still carries a restriction
   on building tools that compete with Webflow's visual building. Fluxion's editor creates static sites
   visually → treat as **legal-review-required**; architect so GSAP could be an *optional backend plugin*.
5. **Motion's momentum.** Motion (MIT) now includes `animateView` (VT wrapper with springs,
   grouping, crop, stagger) free in core; React `AnimateView` requires React 19.3+. Motion's path
   morph story is officially "Motion + flubber".

### 1.3 Engine-per-job verdict

| Job | Primary | Fallback / notes |
|---|---|---|
| Timeline sequencing, builds, seek/scrub | **Fluxion Timeline Scheduler (own, ~5–8 KB)** | GSAP timeline as optional plugin backend |
| Compositor props (x/y/scale/rotate/opacity) of elements | **WAAPI** via scheduler | Motion `animate` (mini) is fine too |
| SVG attribute props (fill/stroke color, stroke width, dash, glow filter params) | **own rAF sampler** writing attributes/CSS vars | anime.js v4 if we want to outsource |
| Path morph | **flubber** interpolators (precomputed) + compatible-path fast lerp | GSAP MorphSVG plugin backend; anime `morphTo` for simple cases |
| Draw-on stroke | `pathLength="1"` + `stroke-dasharray:1` + animate `stroke-dashoffset` (WAAPI works since it's a CSS property) | — |
| Marching ants | CSS keyframes on `stroke-dashoffset` (infinite, cheap) | Canvas for very long/dense connectors |
| Riders along connectors | CSS `offset-path` + WAAPI `offset-distance` (≤ ~50) → Canvas overlay (many) | LUT + rAF transform for Safari edge cases |
| Screen transitions (fade/slide/zoom) | Own **Transition Manager** (WAAPI on two screen layers) | VT API as enhancement |
| Magic move / shared elements across screens | **Own id-matched FLIP using model geometry** (+ morph for shape-type changes) | VT API with `view-transition-name` = element id for DOM-only screens |
| React UI (popups, overlays, player chrome, component shapes) | **Motion** (`LazyMotion` + `m`, `AnimatePresence`, `layoutId`) | — |
| Rich vector assets | **dotLottie** (Lottie JSON) / **Rive** as media plugins | Lazy-load; inline WASM only if used |
| Prezi-style zoom-into-shape | Own camera: one transform on the stage (`matrix`) animated via WAAPI | — |

---

## 2. Path morphing

### 2.1 The problem
Native interpolation of `d` requires identical command structure (same number/type/order of
segments). Morphing a rectangle into a star, or a "server" icon into a "cloud", violates that.
Problems to solve: (1) **resampling** to equal point counts, (2) **correspondence** (which point maps
to which — rotation offset / start index, winding direction), (3) **subpaths & holes** (one-to-many,
many-to-one), (4) **curves** (convert bezier to polyline samples or keep beziers aligned).

### 2.2 Library comparison

| Library | Approach | Different point counts | Subpaths / holes | Output | Status / license | Notes |
|---|---|---|---|---|---|---|
| **flubber** | Polygonize path, resample to equal vertices (`maxSegmentLength`), find best rotation to minimize distance; `interpolate`, `toCircle`, `fromCircle`, `separate`, `combine`, `interpolateAll` | Yes | Yes (separate/combine for 1↔N) | Function `t → d string` (polyline, curves become line segments) | MIT; stable but low activity (feature-complete) | Default recommendation; use `string:false` for arrays then own serializer; precompute |
| **GSAP MorphSVGPlugin** | Bezier-preserving, auto `shapeIndex` (start point) matching, `map: "size"/"position"/"complexity"`, canvas rendering option | Yes | Yes | Tween on `d` | Free (GSAP license) | Highest quality, keeps curves; license caveat |
| **anime.js v4 `svg.morphTo`** | Resamples to point list with `precision` | Yes (resamples) | Limited | Tween | MIT | Good for icon-ish morphs |
| **polymorph** (`polymorph-js`) | Path normalization + fill of missing points, `precision` | Yes | Yes (basic) | Interpolator | MIT; unmaintained since ~2019 | Small; fallback |
| **KUTE.js** (svgMorph / svgCubicMorph) | Polygon resample or cubic-bezier conversion | Yes | Limited | Tween | MIT; low activity | Whole engine — don't adopt |
| **d3-interpolate-path** | Extends shorter path by duplicating points; for *open lines* | Yes | No | Interpolator | BSD | Ideal for **connector route changes** (polyline → polyline), chart lines |
| Native CSS `d: path()` transition | Numeric lerp | **No** | No | CSS | Chromium/Firefox; not Safari (as CSS property) | Only for pre-normalized paths |

### 2.3 Fluxion approach
1. Each shape definition renders to a **canonical path** (absolute, cubic-only: `M C … Z`). Shape
   *types* (rect, ellipse, star, custom icon) all compile to this.
2. If both paths have the same subpath/segment counts → **direct numeric lerp of cubic control points**
   (keeps curves crisp, cheapest).
3. Else → **flubber** with `maxSegmentLength` scaled to screen size (e.g. 2–4 px on desktop, 6–8 px
   on low-end mobile). Use `interpolateAll`/`separate`/`combine` for 1↔N.
4. Precompute interpolators at **screen preload** (idle callback), and optionally **bake K frames**
   (e.g. 30 samples) into strings for mobile; at runtime pick nearest/lerp neighbor frames.
5. Morph *style* separately (fill/stroke colors via OKLCH interpolation, stroke width, corner radius)
   — the path morph only handles geometry.
6. Text inside morphing shapes is a separate layer (crossfade/reflow), never morphed.

---

## 3. Path-following (Riders)

### 3.1 Techniques

| Technique | How | Perf | Notes |
|---|---|---|---|
| `SVGGeometryElement.getTotalLength()/getPointAtLength()` per frame | Query live DOM each frame | Slow if many (forces geometry calc; historically heavy on Safari) | Fine for a few; don't call per frame per rider at scale |
| **Arc-length LUT** | At connector route time, sample N points (e.g. every 2 px) with position + tangent angle; binary search/lerp at runtime | O(log N) per rider, no DOM | Works in workers & canvas; route recalculation invalidates LUT; we can compute from our own geometry (no DOM) |
| **CSS `offset-path: path(...)` + `offset-distance`** | Rider is a DOM/SVG-in-HTML element; WAAPI animates `offset-distance` 0%→100% with `offset-rotate: auto` | **Compositor** (Chrome) when simple → smooth even with main-thread jank | Path is in CSS px of the containing block — put riders in an HTML overlay with same transform as the SVG stage, or regenerate path strings on scale; baseline support since ~2022 |
| SMIL `<animateMotion>` + `<mpath>` | Declarative SVG | OK, main-thread | Works everywhere incl. Safari, but no scrubbing control beyond `setCurrentTime` on the whole SVG; avoid as core |
| **Canvas overlay** (2D or WebGL) | One canvas above the SVG stage draws all riders/particles from LUTs | Scales to thousands; in OffscreenCanvas worker the main thread is free | Hit-testing & a11y must be handled by us; riders become non-DOM (fine for decorative electrons) |

### 3.2 Particle systems along paths
- "Electrons on a power line" = N riders per connector with phase offsets `(i / N)`; speed in px/s
  (not %/s) so long and short wires look consistent: `distance(t) = (phase*L + speed*t) mod L`.
- Variation: jitter perpendicular to tangent (normal from LUT), size/opacity pulse, trail (draw the
  last k positions with decreasing alpha on canvas), spawn/despawn at endpoints, "flow direction"
  bound to a data variable (e.g. reverse when `current < 0`).
- Rendering thresholds (guideline for mid-range phone, 60 Hz):
  - ≤ 30–50 riders total → SVG/DOM riders with WAAPI `offset-distance` (compositor) or transform.
  - 50–2,000 → single Canvas2D overlay, batched draw (one path per color), devicePixelRatio capped at 2.
  - > 2,000 or glow/trails → WebGL (e.g. instanced points) or OffscreenCanvas in a worker.
- Riders that are **interactive** (clickable electron showing a tooltip) stay DOM/SVG.

### 3.3 Connector animation catalog (all via scheduler)
| Effect | Implementation |
|---|---|
| Draw-on | `pathLength="1"`, `stroke-dasharray: 1 1`, animate `stroke-dashoffset` 1→0 (WAAPI) |
| Marching ants / flow | `stroke-dasharray: 6 4`, infinite linear keyframes on `stroke-dashoffset` (negative = direction) |
| Pulse | Animate stroke-width/opacity, or a second "glow" copy of the path with blurred filter whose opacity pulses (pre-rendered filter; animate opacity only) |
| Gradient flow | Animate `gradientTransform` or `x1/x2` of a linear gradient along the path (main-thread; keep cheap) |
| Traveling highlight (comet) | A short dash (`dasharray: 0.1 0.9` with `pathLength=1`) moved by dashoffset |
| Route change | d3-interpolate-path between old and new route |

---

## 4. Declarative animation & interaction data models (prior art)

| Model | Structure | Triggers | Take-aways for Fluxion |
|---|---|---|---|
| **PowerPoint** (OOXML `p:timing`, SMIL-derived time nodes `p:par`/`p:seq`, `p:cTn` with `presetClass` entr/emph/exit/path) | Per slide: *main sequence* (click-driven) + *interactive sequences* (triggered by clicking a shape or reaching a media bookmark). Each effect: start = On Click / With Previous / After Previous, delay, duration, repeat, rewind, triggers | Click, with prev, after prev, trigger-on-shape-click, media bookmark | Exactly the authoring UX users know: **entrance / emphasis / exit / motion path** categories, **main sequence** of "click steps" plus **triggered sequences**. Adopt the 3 start modes + named triggers |
| **Keynote Magic Move** | Match objects between consecutive slides by identity (same object copied), tween position/size/rotation/opacity; text "by character/word" matching | Slide transition | Id-matched shared-element transitions; allow text morph by word/char |
| **Google Slides** | Simplified PPT: on click / after previous / with previous | Same | Minimal subset is enough for most users |
| **reveal.js** | Fragments (`class="fragment"`, `data-fragment-index`, styles fade-up/highlight/…), `data-auto-animate` with `data-id` matching, `data-auto-animate-easing/duration/delay` | Next/prev keys | Fragment *index* model = our click steps; auto-animate id matching = magic move |
| **Slidev** | `v-click`, `v-after`, `v-clicks`, `:click="3"`, `[x, y]` ranges (visible between clicks), `v-motion` with `:initial/:enter/:click-N` states; click markers in notes | Clicks | **Range visibility** (`at: [2,5]`) and per-click states for one element are very expressive; notes synced to click numbers |
| **Lottie JSON** | Layers with transform + shapes, each property `{a:1,k:[{t,s,i,o}]}` keyframes with bezier easing tangents, markers | None (playback only); dotLottie state machines add states/transitions/inputs | Keyframe format: `{t, v, ease}` with cubic-bezier easing is universal; markers (named time points) are useful |
| **SMIL** | `<animate begin="shape.click; prev.end+0.5s" dur fill="freeze">`, syncbase timing | Event-based `begin` expressions | Syncbase timing (`begin: other.end + 0.5`) is a clean way to express "after previous" graphs |
| **Theatre.js** | Project → Sheets → Objects → props; sequence with keyframes per prop track, `type: bezier/hold` | Programmatic `sequence.play({range, iterationCount})` | Track-per-property editing UX; `hold` (step) keyframes |
| **Rive** | Artboard animations + **state machine**: layers, states (each plays an animation or blend), transitions with conditions on **inputs** (bool, number, trigger), listeners (pointer events on shapes → set inputs) | Pointer listeners, inputs | **Per-element state machine with inputs** is the right model for "component shapes" and hover/press states |
| **Figma prototyping** | Interactions: trigger (On click/tap, On drag, While hovering, While pressing, Key/gamepad, Mouse enter/leave, Mouse down/up, After delay) → actions (Navigate to, Change to [variant], Open/Swap/Close overlay, Back, Scroll to, Open link, **Set variable**, **Conditional** if/else, multiple actions per trigger); animation: Instant, Dissolve, **Smart animate** (name-matched), Move in/out, Push, Slide | Listed | Trigger→actions rules with variables + conditions + smart animate is the best-known interaction model; mirror its vocabulary |
| **XState / SCXML** | Statecharts: states, events, guards, actions, parallel/hierarchical states | Events | Serializable JSON; can be visualized; heavy runtime (~15 KB) — ship a tiny interpreter for our subset |

---

## 5. Presentation frameworks & presenter features

| Product | Ideas worth taking | Notes |
|---|---|---|
| **reveal.js** | Fragments; auto-animate (`data-id`); vertical stacks (drill-down); overview mode; speaker view (separate window, notes, timer, next slide) synced via `postMessage`; `?print-pdf` export via print CSS; multiplex plugin (socket.io) for audience follow; `data-background-*` | Mature, framework-agnostic HTML |
| **Slidev** | Markdown + Vue; click system (`v-click`, ranges), `v-motion`; presenter mode `/presenter` with notes click markers; drawing/annotations (drauu); recording; export PDF/PNG/PPTX via Playwright; remote control via `--remote` | Sync between windows via BroadcastChannel/ws in dev server |
| **Spectacle** (React) | JSX slides, `<Appear>` steps, presenter mode, `Stepper` for sequences | React-native model close to ours |
| **impress.js** | 3D-positioned steps on an infinite canvas; camera transform between steps | Proof that "camera over a canvas" = one CSS transform |
| **Prezi** | Zoomable canvas, frames as zoom targets, path of frames, "zoom reveal" | Our zoom-to-shape: compute bbox → camera matrix, animate with ease-in-out and a slight "zoom-out-then-in" arc when distance is large (van Wijk & Nuij smooth zoom) |
| **Pitch** | Collaborative, polished templates, live-video presenter, per-block animations (simple) | Keep animation vocabulary small & tasteful by default |
| **Gamma** | AI-generated **responsive cards** (not fixed 16:9), nested cards, "expand" toggles, web-first sharing | Validates our mobile "reflow" mode: screens become vertically stacked cards on phones |
| **Tome** | AI narrative, responsive tiles (pivoted away from presentations 2024) | Cautionary: presentation-only AI tools struggled; broader docs/sites use-case helps |
| **Canva** | Page animations presets (Rise, Pan, Fade, Pop…), "Magic animate", timing per element | Presets named for effect feel, not parameters |
| **Marp** | Markdown → slides, directives | AI-friendly text source |
| **MDX Deck** | MDX slides, `<Steps>`, presenter mode | Deprecated-ish; ideas absorbed by Spectacle/Slidev |

### 5.1 Presenter features — implementation notes
- **Speaker view (dual window):** `window.open()` a second view of the same single file with
  `#presenter`; sync via **BroadcastChannel** (same-origin; works for `file://`? — in Chromium,
  `file://` pages share an opaque origin per file which blocks BroadcastChannel in some browsers;
  fallback: keep `window.opener` reference and use `postMessage`, which always works for windows
  we opened). Message = `{type:'goto', screen, step, t}` + heartbeats. Presenter window renders
  current + next step, notes (step-synced like Slidev click markers), timers.
- **Timers:** elapsed, per-screen budget, countdown with color states; pacing indicator vs planned
  durations stored in the document.
- **Remote control from phone:** needs a network path. Options: (a) WebRTC data channel with
  QR-code signaling via a tiny relay (online only), (b) local network via optional companion app,
  (c) Bluetooth clicker = keyboard events (PageDown/PageUp/Arrow/`B` black screen) — must work offline.
  Keep remote as an **optional plugin**; offline core = keyboard clickers.
- **Laser pointer:** overlay canvas; pointer position broadcast to audience window as normalized
  coordinates in screen space (not viewport).
- **Ink annotations:** perfect-freehand style strokes on an overlay layer; stored as *session
  annotations* (optionally saveable into the document as a layer), never mutating elements.
- **Overview / jump:** grid of screen thumbnails; typed number + Enter jumps (reveal/PowerPoint habit).
- **Black/white screen**, **zoom (magnifier)** by pinch/scroll during presentation.
- **Export:** print CSS (one screen per page, final step state) + static "handout" mode; PDF via
  browser print — no extra dependency.

---

## 6. Interaction model for Present mode

Principles:
1. **Two orthogonal mechanisms:** (a) the **linear build** (main sequence of steps advanced by
   next/prev), (b) **interactive rules** (trigger → actions) that can fire anytime. Same as PPT's main
   vs. triggered sequences and Figma's interactions.
2. **Per-screen state** = `{ step, variables, elementStates, overlayStack }`. Element visual states
   (e.g. "expanded", "highlighted", "on"/"off") are named **variants** (Figma "Change to").
3. **State machine** optional per screen/element for complex logic (Rive/XState-like), serialized
   as JSON, interpreted by a ~2 KB runtime (no XState in the Player).
4. **Actions are declarative & reversible where possible**, so "prev" can undo (store inverse or
   recompute state from step index: *state = fold(actions up to step)* — deterministic replay,
   which also makes edit-mode preview and speaker-view sync trivial).
5. **Hotspots:** any element, or an invisible `hotspot` element, can carry interactions. Min
   touch target 44×44 CSS px enforced by an invisible hit-area expansion on mobile.
6. **Branching navigation:** `navigate` with `history` push; `back` pops; "return to main path"
   after a detour (PowerPoint custom shows / reveal vertical stacks). Screens can declare
   `next` explicitly (graph, not only a list).
7. **Drill-down / zoom-into-shape:** `zoomTo(elementId)` animates the camera to the element's bbox;
   the target may be a **sub-screen** embedded in the element (nested canvas, Prezi-like) which becomes
   active (its own steps/interactions) until `zoomOut`.

---

## 7. Accessibility & motion

| Topic | Requirement / approach |
|---|---|
| `prefers-reduced-motion: reduce` | Global motion policy: `full` / `reduced` / `none`. In *reduced*: replace movement/zoom/morph transitions with crossfades ≤ 200 ms; stop infinite loops (marching ants, riders) or render them as static direction arrows; parallax off. Authors can mark an animation `essential: true` (conveys meaning) → still play but simplified. Also a user toggle in the Player (doesn't rely only on OS setting). WCAG 2.3.3 (Animation from Interactions), 2.2.2 (Pause, Stop, Hide — anything moving > 5 s must be pausable) |
| Flashing | Block effects > 3 flashes/s (WCAG 2.3.1) — validator rule on pulse/glow frequency |
| Keyboard | Arrow/Space/PageUp/PageDown/Home/End for navigation; Tab cycles *interactive* elements of the current screen in reading order (document order = author-defined `tabIndex`/reading order, not z-order); Enter/Space activates the element's `click` interactions; Esc closes overlay / zooms out; `?` shows shortcuts |
| Screen readers | Player root `role="region" aria-roledescription="presentation"`; each screen `role="group" aria-roledescription="slide" aria-label="Screen 3 of 12: Title"`; live region (`aria-live="polite"`) announces screen changes and newly revealed build steps (text of revealed elements); hidden-by-build elements are `aria-hidden`/`inert` until revealed; diagrams expose an accessible **text alternative** (element labels + connector relations as a list: "Generator → Transformer (power line)"); decorative riders `aria-hidden` |
| Popups / overlays | Use `<dialog>` (`showModal()`) — native focus trap, `inert` background, Esc; return focus to the trigger on close; `aria-labelledby`. Non-modal popovers: HTML `popover` attribute (baseline 2024) with `popovertarget` |
| Hover-only content | Never hover-only: every `hover` trigger has a tap/focus equivalent (WCAG 1.4.13 content on hover/focus: dismissible, hoverable, persistent) |
| Focus visibility | Visible focus ring on SVG elements (`:focus-visible` outline via an overlay rect) |
| Mobile | Swipe for next/prev with `touch-action` rules; ensure pinch-zoom isn't disabled for text-reading mode |

---

## 8. Performance (mobile first)

### 8.1 Rules
1. **Compositor-only where possible:** animate `transform`, `opacity`, `offset-distance`, and
   (Chromium) `filter` on promoted layers. For SVG, prefer transforming a `<g>` wrapper via CSS
   `transform` (with `transform-box: fill-box`) — WAAPI on SVG elements runs on the main thread in
   most engines, so for heavy screens promote animated shapes into **separate HTML-wrapped layers**
   (each element an absolutely positioned `<svg>`), which lets WAAPI composite them.
2. **Glow effects:** don't animate `filter: blur()`/`drop-shadow` radii per frame on mobile. Render
   the glow once (a blurred duplicate, or a pre-rasterized sprite) and animate its **opacity/scale**.
3. **`will-change`:** apply only for the duration of an animation (scheduler adds/removes), never
   blanket — each promoted layer costs GPU memory (critical on iOS; too many layers → crash/tiles
   blank).
4. **One rAF loop** (the scheduler) for all main-thread sampling; batch **reads then writes**; never
   read layout (`getBBox`, `getBoundingClientRect`, `getTotalLength`) inside the frame loop — geometry
   comes from our model/LUTs.
5. **Frame budget:** 60 Hz → 16.7 ms total, ~8–10 ms for our JS+style+paint on mid-range Android
   (e.g. Snapdragon 6-series / Helio G-class). 120 Hz devices halve that: our sampler must be
   *time-based* (not frame-count) and degrade gracefully (drop to 60 Hz sampling for main-thread
   props; compositor props still run at native rate).
6. **Adaptive quality:** measure frame times over the first second of a screen; if p90 > 20 ms, step
   down: bake morph frames, reduce rider count/trails, disable glows, cap DPR at 1.5, swap fancy
   transitions for fades.
7. **Preload next screen** (idle time): build its DOM hidden (`content-visibility: hidden`/off-screen),
   precompute morph interpolators and LUTs, decode images (`img.decode()`), so the transition does no
   work besides animating.
8. **Pause offscreen/hidden work:** stop loops when the tab is hidden (`visibilitychange`) or screen
   not visible (IntersectionObserver in site/scroll mode).
9. **OffscreenCanvas + Worker** for rider/particle canvases (supported in Chrome, Firefox, Safari 17+);
   transfer via `transferControlToOffscreen()`; main thread posts timeline time only. In a single-file
   build, create workers from a `Blob` URL of inlined code.
10. **React:** animation values must **never go through React state per frame**. Components render
    structure; the scheduler writes to DOM refs/CSS variables directly (same principle as Motion's
    MotionValues).

### 8.2 Transition cost table (mobile guidance)

| Transition | Cost | Notes |
|---|---|---|
| Fade / slide / push / zoom (screen-level) | Low | Two composited layers, WAAPI |
| Camera zoom-into-shape | Low–Med | One transform; text may rasterize blurry mid-zoom — re-render at end (and use `will-change` removal to re-raster crisply) |
| Magic move (id-matched transforms) | Med | Transform/opacity per matched element; OK up to ~100 elements |
| Magic move with morph + color | Med–High | Main-thread `d` updates; limit morphing count (~10–20 paths) on mobile |
| View Transitions API | Low–Med | Bitmap snapshots; memory spike for large screens |
| Riders: 50 DOM / 2,000 canvas | Low / Med | See §3.2 |

---

## 9. RECOMMENDATION

### 9.1 Engines by job (final)

| Layer | Choice | Why |
|---|---|---|
| Document animation model | **Fluxion Animation Schema (own, JSON)** | AI-generatable, validated with zod/JSON Schema, engine-independent, scrubbable |
| Timeline evaluation | **Own Scheduler** (pure `sample(t)` functions + WAAPI delegation) | Determinism for edit preview & speaker sync; small; no license risk |
| Compositor tweening | **WAAPI** | Native, 0 KB, off-main-thread, `currentTime` seek |
| Easing | cubic-bezier + CSS `linear()` strings for springs/bounces (pre-baked from spring params) | Same easing works in WAAPI and in our sampler |
| Path morph | **flubber** (+ own compatible-path lerp) | MIT, robust for arbitrary shapes |
| Route morph | **d3-interpolate-path** | Open polylines |
| Riders | Own LUT + CSS `offset-path`/WAAPI; Canvas/OffscreenCanvas overlay beyond threshold | Scales |
| React UI motion | **Motion** (`LazyMotion`/`m`, `AnimatePresence`, `layoutId`) | Popups, overlays, player chrome; also exposed to component-shape authors |
| Screen transitions | Own **Transition Manager**; VT API (+ Motion `animateView`) as optional enhancement for DOM-heavy screens | Model geometry beats DOM measurement; VT bitmaps unsuitable for big zooms |
| Vector assets | **dotLottie** and **Rive** player plugins (lazy, opt-in, WASM inlined only when used) | Designer assets, not core |
| Optional backend | GSAP plugin (MorphSVG/Flip) — after legal review | Quality ceiling |
| Editor timeline UI | Borrow Theatre.js concepts (tracks, keyframe lanes, curve editor) — don't depend | — |

### 9.2 Proposed serializable schema (TypeScript sketch)

Design goals: compact for LLMs (presets + sensible defaults), all times in ms, ids are strings
referencing element ids, everything JSON (no functions), versioned, validated by JSON Schema.

```ts
// ---------- primitives ----------
type Id = string;
type Ms = number;
type Easing =
  | 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
  | 'back-out' | 'elastic-out' | 'bounce-out'             // named presets → baked linear()
  | { cubicBezier: [number, number, number, number] }
  | { spring: { stiffness?: number; damping?: number; mass?: number } } // baked to linear() + duration
  | { steps: number; position?: 'start' | 'end' };

type Color = string;             // any CSS color; interpolated in OKLCH
type AnimatableValue = number | string | Color | [number, number];

// ---------- keyframes & tracks ----------
interface Keyframe<V = AnimatableValue> {
  at: number;                    // 0..1 offset within the effect (or ms if `absolute`)
  value: V;
  ease?: Easing;                 // easing to the NEXT keyframe
  hold?: boolean;                // step (no interpolation)
}

type AnimProp =
  | 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate' | 'opacity'      // compositor
  | 'fill' | 'stroke' | 'strokeWidth' | 'cornerRadius'                      // style
  | 'glow' | 'shadow' | 'blur'                                               // effect params
  | 'geometry'                                                               // path morph (value = shape ref / path)
  | 'draw'                                                                   // 0..1 stroke reveal
  | 'dashOffset' | 'textReveal'
  | `var:${string}`;                                                         // CSS var / component prop

interface Track {
  prop: AnimProp;
  keyframes: Keyframe[];         // ≥ 2, or 1 = "to" from current value
}

// ---------- effects (what an animation does) ----------
type EffectKind = 'entrance' | 'emphasis' | 'exit' | 'motion' | 'custom';

interface EffectBase {
  id: Id;
  target: Id | Id[];             // element(s); arrays apply `stagger`
  kind: EffectKind;
  duration?: Ms;                 // default by preset
  delay?: Ms;
  ease?: Easing;
  repeat?: number | 'infinite';
  yoyo?: boolean;
  stagger?: Ms | { each: Ms; from?: 'start' | 'end' | 'center' | 'random' };
  essential?: boolean;           // keep (simplified) under reduced motion
  fillMode?: 'forwards' | 'none';// keep end state (default forwards for entrance/emphasis)
}

type Effect =
  | (EffectBase & { preset: 'fade' | 'fly-in' | 'zoom' | 'wipe' | 'pop' | 'draw' | 'typewriter';
                    direction?: 'left' | 'right' | 'up' | 'down' })
  | (EffectBase & { preset: 'pulse' | 'glow' | 'shake' | 'color' | 'border' | 'spin' | 'grow';
                    params?: Record<string, AnimatableValue> })
  | (EffectBase & { preset: 'morph'; to: { shape: string } | { path: string } | { elementId: Id } })
  | (EffectBase & { preset: 'motion-path'; path: { connectorId: Id } | { d: string };
                    autoRotate?: boolean; from?: number; to?: number })
  | (EffectBase & { preset: 'flow';                     // connector marching ants / pulse
                    style: 'ants' | 'pulse' | 'comet' | 'gradient'; speed?: number; reverse?: boolean })
  | (EffectBase & { preset: 'riders';                   // electrons along a connector
                    connectorId: Id; rider: { shape?: string; componentId?: Id; size?: number; color?: Color };
                    count: number; speed: number /* px/s */; jitter?: number; trail?: number;
                    reverseWhen?: Expr })
  | (EffectBase & { preset: 'custom'; tracks: Track[] })
  | (EffectBase & { preset: 'component'; call: string; args?: Record<string, unknown> }); // component-shape API

// ---------- builds (PowerPoint-like steps) ----------
type Start = 'onClick' | 'withPrevious' | 'afterPrevious';

interface BuildItem {
  effect: Effect;
  start: Start;                  // relative to previous item in the same sequence
  offset?: Ms;                   // extra delay (SMIL syncbase "+0.5s")
}

interface Sequence {
  id: Id;
  items: BuildItem[];
}

interface ScreenTimeline {
  onEnter?: Sequence;            // autoplay when screen appears (with/after previous items)
  main: Sequence;                // click-advanced steps (next/prev)
  triggered?: Sequence[];        // played by interactions (PowerPoint "triggers")
  loops?: Effect[];              // ambient, always-on (ants, riders, idle pulses), pausable
  markers?: Record<string, Ms>;  // named cue points (for 'onEvent' and speaker-note sync)
}

// ---------- interactions (Figma-like) ----------
type Expr = string;              // tiny safe expression language: "vars.power > 5 && state == 'on'"

type Trigger =
  | { on: 'click' | 'tap' | 'doubleClick' | 'hoverStart' | 'hoverEnd' | 'focus' | 'longPress'; element: Id }
  | { on: 'key'; key: string }
  | { on: 'screenEnter' | 'screenExit' }
  | { on: 'afterDelay'; ms: Ms }
  | { on: 'sequenceEnd' | 'marker'; ref: Id }
  | { on: 'varChange'; variable: string }
  | { on: 'event'; name: string; source?: Id };      // emitted by component shapes / media bookmarks

type Action =
  | { do: 'next' | 'prev' | 'back' }
  | { do: 'navigate'; screen: Id; transition?: TransitionSpec; returnTo?: 'here' }
  | { do: 'zoomTo'; element: Id; padding?: number; enterSubScreen?: boolean; transition?: TransitionSpec }
  | { do: 'zoomOut' }
  | { do: 'openOverlay'; screen: Id | { elementGroup: Id }; modal?: boolean; position?: 'center' | 'anchor'; anchor?: Id }
  | { do: 'closeOverlay' }
  | { do: 'play' | 'pause' | 'reverse' | 'restart' | 'seek'; sequence: Id; at?: Ms | string /* marker */ }
  | { do: 'setVariant'; element: Id; variant: string; transition?: TransitionSpec } // smart-animate between variants
  | { do: 'setVar'; variable: string; value: Expr }
  | { do: 'toggle'; element: Id; prop: 'visible' | 'variant'; values?: [string, string] }
  | { do: 'emit'; name: string; payload?: unknown }
  | { do: 'openLink'; url: string }
  | { do: 'if'; cond: Expr; then: Action[]; else?: Action[] };

interface Interaction { id: Id; trigger: Trigger; actions: Action[]; once?: boolean; when?: Expr }

// ---------- state machines (optional, per screen or element) ----------
interface StateMachine {
  id: Id;
  initial: string;
  states: Record<string, {
    variant?: Record<Id, string>;          // element → variant while in state
    onEnter?: Action[];
    on?: Record<string /* event */, { target: string; cond?: Expr; actions?: Action[] }>;
  }>;
}

// ---------- transitions ----------
interface TransitionSpec {
  type: 'none' | 'fade' | 'slide' | 'push' | 'cover' | 'zoom' | 'magicMove' | 'morph' | 'camera';
  direction?: 'left' | 'right' | 'up' | 'down' | 'auto';
  duration?: Ms;
  ease?: Easing;
  match?: 'id' | 'name' | 'explicit';      // magic move matching strategy
  pairs?: [Id, Id][];                        // explicit matches across screens
  morphShapes?: boolean;                     // allow geometry morph when shape types differ
  fallback?: 'fade';                         // under reduced motion / low perf
}

// ---------- screen-level attachment ----------
interface ScreenAnimationData {
  timeline: ScreenTimeline;
  interactions: Interaction[];
  variables?: Record<string, number | string | boolean>;
  machines?: StateMachine[];
  transitionIn?: TransitionSpec;           // default when entering this screen
  next?: Id | { if: Expr; then: Id; else: Id }; // branching graph
}
```

Example an LLM could emit:

```json
{
  "timeline": {
    "onEnter": { "id": "enter", "items": [
      { "start": "withPrevious", "effect": { "id": "e1", "target": ["gen","xfmr","city"], "kind": "entrance", "preset": "pop", "stagger": 120 } }
    ]},
    "main": { "id": "main", "items": [
      { "start": "onClick", "effect": { "id": "e2", "target": "line1", "kind": "entrance", "preset": "draw", "duration": 800 } },
      { "start": "afterPrevious", "effect": { "id": "e3", "target": "line1", "kind": "emphasis", "preset": "riders",
          "connectorId": "line1", "rider": { "shape": "circle", "size": 6, "color": "#ffd400" }, "count": 12, "speed": 120, "repeat": "infinite" } },
      { "start": "onClick", "effect": { "id": "e4", "target": "city", "kind": "emphasis", "preset": "glow", "params": { "color": "#ffd400" } } }
    ]}
  },
  "interactions": [
    { "id": "i1", "trigger": { "on": "click", "element": "xfmr" }, "actions": [ { "do": "zoomTo", "element": "xfmr", "enterSubScreen": true } ] }
  ]
}
```

Schema notes:
- **Presets compile to tracks.** The Player ships a preset registry (`fade`, `pop`, `glow`, …) →
  `Track[]`; plugins can register presets. The editor can "explode" a preset into custom tracks.
- **Validation** rejects: unknown targets, cycles in `afterPrevious` graphs, flashes > 3 Hz,
  infinite effects in `main` without `loops`, unsafe expressions. Repair hints for AI.
- **Expressions**: tiny evaluator (no `eval`), identifiers `vars.*`, `state`, `step`, literals,
  arithmetic, comparisons, `&&`/`||`/`!`.

### 9.3 Player runtime architecture

```
┌────────────────────────── Player ──────────────────────────┐
│  Input layer: keyboard, pointer/touch, clicker, remote msg  │
│        │ normalized events                                  │
│        ▼                                                    │
│  Trigger Bus (pub/sub) ──► Interaction Engine (rules, vars, │
│        ▲                     expr eval, state machines)     │
│        │ emits                     │ actions                │
│  Component shapes / media ◄────────┤                        │
│                                    ▼                        │
│  Presentation Controller (screen graph, history, step idx,  │
│     overlay stack, camera) ──► Sync Channel (speaker view,  │
│        │                        remote, audience window)    │
│        ├──► Transition Manager (screen A→B: fade/slide/      │
│        │     zoom/magic-move/morph; VT API optional)        │
│        ▼                                                    │
│  Timeline Scheduler                                         │
│   - compiles Sequences → absolute time graph               │
│   - clock (play/pause/seek/rate), single rAF loop           │
│   - backends: WAAPI driver | rAF sampler | canvas riders    │
│   - reduced-motion & adaptive-quality policies              │
│        ▼                                                    │
│  Render layer: React tree (structure) + direct DOM writes   │
│   (refs, CSS vars) + overlay canvases (riders, ink, laser)  │
└─────────────────────────────────────────────────────────────┘
```

**Timeline Scheduler**
- Compile each `Sequence` into *steps*: a step = the group started by an `onClick` item plus all
  following `withPrevious`/`afterPrevious` items until the next `onClick`. Resolve each item to an
  absolute `[begin, end]` inside the step (SMIL-style syncbase resolution). `repeat: infinite`
  items are moved to an ambient layer.
- `seek(step, t)`: state at any point = apply end-states of all prior steps (fast path: precomputed
  end snapshots) + sample current step at `t`. This powers: `prev`, speaker-view sync, edit-mode
  scrubbing, deep links (`#screen/3/step/2`), print/PDF (final state), thumbnails.
- Backends per track: compositor props → WAAPI `Animation` objects created paused, driven via
  `play()`/`currentTime` (edit mode sets `currentTime` directly); attribute props → sampler functions
  `f(progress) → write` invoked in the single rAF loop; riders → canvas/offset-path backend.
- Interrupts: starting a step while previous one is running → *complete* (jump to end) by default
  (PowerPoint behavior), configurable `interrupt: 'finish' | 'blend'`.

**Trigger Bus**
- Typed event stream: DOM input events mapped to element ids by hit-testing via `data-el-id`
  (event delegation on the stage root, one listener per type), timers (`afterDelay`), timeline
  events (`sequenceEnd`, `marker`), variable changes, component `emit`s. Debounce/guard re-entrancy;
  queue actions and execute serially per microtask to keep deterministic ordering.
- Component shapes get a sandboxed API: `useFluxion()` → `{ progress, step, vars, emit, on, reducedMotion }`
  so their internal animations (Motion or anything) follow the global clock (important for edit
  preview: components must accept a controlled `time` prop / `seek` callback to be faithful).

**Transition Manager**
- Holds up to 2 mounted screens (current + incoming) + preloaded next.
- Magic move algorithm: match elements by `id` (then name, then explicit pairs) → for each match,
  compute from/to transforms from **model geometry** (no DOM measurement), interpolate style props;
  morph geometry if shape types differ and `morphShapes` is on; unmatched: fade out/in (with small
  scale). Connectors attached to moved shapes are re-routed per frame from interpolated endpoints
  (or morph route via d3-interpolate-path when topology is stable).
- Camera transitions: animate a single stage matrix; for long jumps use a zoom-out-pan-zoom-in arc.
- Uses VT API only when the screen is mostly DOM/HTML components and the browser supports it; falls
  back to own implementation.

**Edit-mode faithful preview**
- Editor uses *the same Player runtime* in a controlled mode: scheduler clock is driven by the
  timeline panel (scrub = `seek`), interactions can be simulated (click a trigger in "preview
  interactions" mode). No separate preview implementation → WYSIWYG by construction.
- "Animation pane" lists compiled steps with start types, durations, a Gantt-style view per
  sequence (Theatre.js-like tracks for custom effects).

### 9.4 Mobile strategy
1. **Two presentation layouts:** *Stage* (fixed logical size scaled to fit, like slides; used on
   desktop and landscape tablets) and *Flow* (Gamma-like responsive cards; each screen reflows into
   vertical sections on portrait phones, builds become scroll-driven or tap-to-reveal).
2. **Gestures:** swipe left/right = next/prev step; tap on hotspot = interaction; tap elsewhere =
   next (configurable); pinch = temporary magnifier, not browser zoom of the whole UI;
   long-press = hover equivalent.
3. **Performance tiers** detected at runtime (`navigator.hardwareConcurrency`, `deviceMemory`,
   measured frame times): `high` (all effects), `medium` (baked morphs, canvas riders, capped DPR),
   `low` (fades only, static flow arrows). Author can preview each tier in editor.
4. **Precompute & lazy:** LUTs, morph interpolators, baked frames per screen in idle time; lazy-init
   Lottie/Rive only when their screen is near.
5. **Battery/visibility:** pause ambient loops when hidden or after N seconds idle in site mode;
   respect `prefers-reduced-motion` and Data Saver.
6. **Single-file constraints:** everything inlined (JS, fonts subset, WASM base64 only for used
   plugins); workers via Blob URLs; no network assumptions; BroadcastChannel/postMessage for
   multi-window.

### 9.5 Open questions / follow-ups
- Legal review of GSAP standard license vs. Fluxion's visual site builder use case.
- Benchmark on a reference mid-range Android (e.g. Pixel 6a / Galaxy A5x) and an older iPhone:
  DOM riders vs canvas thresholds, flubber morph cost per frame, VT memory on large screens.
- Decide on WAAPI-on-SVG vs HTML-wrapped-layer promotion strategy after benchmarks.
- `file://` BroadcastChannel behavior across Chrome/Safari/Firefox (fallback to `window.opener.postMessage`).

---

## Sources

- GSAP free incl. plugins: https://webflow.com/updates/gsap-becomes-free · https://css-tricks.com/gsap-is-now-completely-free-even-for-commercial-use/ · https://gsap.com/community/standard-license/ · https://gsap.com/pricing/ · https://tympanus.net/codrops/2025/05/14/from-splittext-to-morphsvg-5-creative-demos-using-free-gsap-plugins/
- Motion: https://motion.dev/docs/react-layout-animations · https://motion.dev/docs/react-lazy-motion · https://motion.dev/docs/react-reduce-bundle-size · https://motion.dev/docs/animate-view · https://motion.dev/docs/react-animate-view · https://motion.dev/magazine/a-view-transitions-api-for-the-rest-of-us · https://motion.dev/tutorials/js-svg-path-morphing · https://motion.dev/docs/react-svg-animation · https://motion.dev/docs/react-upgrade-guide
- anime.js v4: https://github.com/juliangarnier/anime/releases/tag/v4.0.0 · https://animejs.com/documentation/svg · https://animejs.com/documentation/svg/createmotionpath/ · https://animejs.com/documentation/svg/createdrawable · https://github.com/juliangarnier/anime/wiki/Migrating-from-v3-to-v4
- View Transitions: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API · https://developer.chrome.com/blog/view-transitions-in-2025 · https://developer.chrome.com/blog/element-scoped-view-transitions · https://developer.chrome.com/docs/css-ui/view-transitions/element-scoped-view-transitions · https://css-tricks.com/cross-document-view-transitions-part-1/ · https://brainstormsandraves.com/css/view-transitions-2026/
- React ViewTransition: https://react.dev/blog/2026/09/09/react-19-3 · https://frontendmasters.com/blog/reacts-viewtransition-element/
- CSS Motion Path: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/offset-path · https://css-tricks.com/almanac/properties/o/offset-distance/ · https://danielcwilson.com/blog/2020/01/motion-path-quirks/
- Path morphing: https://github.com/veltman/flubber · https://veltman.github.io/flubber/ · https://www.bram.us/2017/06/21/smooth-svg-path-morphing-with-flubber/ · https://gsap.com/svg/ · https://popmotion.io/learn/morph-svg/
- React Spring / Popmotion: https://github.com/pmndrs/react-spring/releases · https://snyk.io/advisor/npm-package/popmotion-react
- Lottie / Rive: https://unicornicons.com/blog/lottie-vs-rive-performance · https://www.carmenansio.com/articles/animated-icon-libraries/ · https://rive.app/blog/why-importing-lotties-isn-t-the-workflow-rive-was-built-for · https://uithings.com/lottie-animations
- Theatre.js: https://www.theatrejs.com/docs/latest/manual/projects · https://www.theatrejs.com/docs/latest/api/core · https://github.com/theatre-js/theatre/issues/504
- PowerPoint animation model: https://support.microsoft.com/en-us/office/animate-text-or-objects-305a1c94-83b1-4778-8df5-fcf7a9b7b7c6 · https://en.wikipedia.org/wiki/PowerPoint_animation · https://www.ecma-international.org/publications-and-standards/standards/ecma-376/
- Figma prototyping: https://help.figma.com/hc/en-us/articles/360040035834-Prototype-triggers · https://help.figma.com/hc/en-us/articles/15253220891799-Multiple-actions-and-conditionals · https://help.figma.com/hc/en-us/articles/14506587589399-Use-variables-in-prototypes · https://help.figma.com/hc/en-us/articles/15253194385943-Use-expressions-in-prototypes
- reveal.js: https://revealjs.com/auto-animate/ · https://revealjs.com/config/ · https://github.com/hakimel/reveal.js/releases
- Slidev: https://sli.dev/guide/animations · https://sli.dev/features/click-marker · https://sli.dev/guide/ui · https://docs-legacy.sli.dev/guide/presenter-mode
- WCAG references (2.2.2, 2.3.1, 2.3.3, 1.4.13): https://www.w3.org/TR/WCAG22/
