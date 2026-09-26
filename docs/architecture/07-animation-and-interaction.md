# 07 — Animation & Interaction (`@fluxion/anim`, `@fluxion/player`)

> Read when: touching the animation/interaction schema (`timeline`, `step`, `interaction`,
> `variable` records, `connector.riders`, `connector.effects`, `screen.transition`), the effect
> registry, morphing, riders, the expression interpreter, the player runtime, transitions,
> overlays, deep links, speaker view, reduced motion, or `<fluxion-player>`.
> Research basis: `research/03` §2.3 (morph), §3 (riders), §5.1 (presenter), §6 (interaction model),
> §7 (a11y), §8 (performance), §9 (recommendation). Requirements: `17-…` (ANI, TML, TRN, MRP, FLW),
> `18-interaction.md`, `16-…` (PRS, SPK, RSP), FR-RDR-*, NFR-PERF-004/008, NFR-A11Y-003/004,
> NFR-SEC-007. Decision: ADR-0006.

## 1. Split of responsibilities

| `anim` (L2, pure) | `player` (L4, DOM) |
|---|---|
| Schema evaluation: compile steps into click groups; `sample(model, pos)`; build-state fold | Clock and the single rAF loop; WAAPI driver; attribute sampler; rider backends |
| Effect registry → keyframe tracks; interpolation (numbers, OKLCH colors, transforms) | Input → trigger bus → interaction engine → presentation controller |
| Morph (flubber and same-structure fast path), route morph, rider arc-length LUTs | Transition manager, overlays, deep links, speaker sync, a11y announcements |
| Expression interpreter with limits | Motion policy, performance tiers, pause-when-hidden, `<fluxion-player>` |

The invariant is that **every visual state is `anim.sample(model, position)`**. WAAPI, canvas
riders and transitions are *renderers* of that state and never the source of truth, which keeps
deep links, `prev`, scrubbing, speaker sync and exports exact (01 §3).

## 2. Serializable schema (records from 02 §2)

```ts
type Ms = number;
type Expr = string;                                   // safe expression source (§3.5)
type Easing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'back-out' | 'bounce-out'
  | { cubicBezier: [number, number, number, number] } | { spring: { stiffness?: number; damping?: number; mass?: number } }
  | { steps: number; position?: 'start' | 'end' };  // named/spring → baked CSS linear() string

type AnimProp = 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate' | 'opacity'   // compositor
  | 'fill' | 'stroke' | 'strokeWidth' | 'radius' | 'glow' | 'blur'                  // style
  | 'geometry' | 'draw' | 'dashOffset' | 'textReveal' | `param:${string}` | `var:${string}`;
interface Keyframe { at: number /*0..1*/; value: number | string | TokenRef; ease?: Easing; hold?: boolean }
interface Track { prop: AnimProp; keyframes: Keyframe[] }            // 1 keyframe = "to" from current

interface Animation {                  // item of step.animations
  id: string; targets: RecordId[];
  effect: string;                      // effect registry id: 'fade-in', 'fly-in', 'pulse', 'motion-path',
                                       // 'morph', 'keyframes', 'riders.burst', '<pack>:<name>'
  params?: Record<string, unknown>;    // validated by the effect's schema
  tracks?: Track[];                    // only for effect 'keyframes' (FR-ANI-006)
  start?: 'with' | 'after';            // within the step, relative to previous animation (default 'with')
  delay?: Ms; duration?: Ms; easing?: Easing; stagger?: Ms;
  iterations?: number | 'infinite'; direction?: 'normal' | 'reverse' | 'alternate';
  fill?: 'forwards' | 'none'; essential?: boolean;   // essential: simplified, not dropped, under reduced motion
}

type StepTrigger =                                    // FR-TML-001
  | { kind: 'onClick' } | { kind: 'withPrevious' } | { kind: 'afterPrevious'; delay?: Ms }
  | { kind: 'onEvent'; name: string; source?: RecordId } | { kind: 'onEnter' } | { kind: 'onTime'; at: Ms };

interface TimelineRecord extends BaseRecord { type: 'timeline'; screenId: RecordId; name: 'main' | string; index: Index; loop?: boolean }
interface StepRecord extends BaseRecord { type: 'step'; timelineId: RecordId; index: Index;
  trigger: StepTrigger; animations: Animation[]; label?: string }

interface TransitionSpec {                            // screen.transition; action overrides (FR-TRN-004)
  type: 'none' | 'fade' | 'slide' | 'push' | 'cover' | 'uncover' | 'zoom' | 'flip' | 'dissolve'
      | 'magicMove' | 'zoomInto';
  direction?: 'left' | 'right' | 'up' | 'down' | 'auto'; duration?: Ms; easing?: Easing;
  back?: Omit<TransitionSpec, 'back'>;                // per-direction variant
  morphShapes?: boolean;                              // magicMove: geometry morph when outlines differ
}

interface Rider {                                     // connector.riders[] (FR-RDR-001..004)
  id: string; shape?: string; componentId?: string; size: number; style?: Partial<Style>;
  count: number; spacing?: number;                    // default: evenly phased (i / count)
  speed: number | { duration: Ms };                   // px/s keeps long & short wires consistent
  direction: 'forward' | 'backward' | 'pingPong'; loop: boolean; easing?: Easing;
  rotateToPath?: boolean; startOffset?: number; trail?: number; jitter?: number;
  autoplay: boolean; emitArrive?: boolean; speedExpr?: Expr;
}
interface FlowEffect {                                // connector.effects[] (FR-FLW-001..003)
  id: string; kind: 'drawOn' | 'ants' | 'pulse' | 'glow' | 'colorSweep' | 'comet';
  direction: 'forward' | 'reverse' | 'both'; speed?: number; color?: StyleValue<string>;
  autoplay: boolean; bind?: { speed?: Expr; width?: Expr };
}

type Trigger =                                        // FR-INT-001
  | { on: 'click' | 'doubleClick' | 'hoverEnter' | 'hoverLeave' | 'longPress' }   // owner element
  | { on: 'key'; key: string } | { on: 'screenEnter' | 'screenExit' }
  | { on: 'stepReached'; step: number } | { on: 'timer'; ms: Ms; repeat?: boolean }
  | { on: 'varChange'; variable: string } | { on: 'riderArrive'; connectorId: RecordId; riderId?: string }
  | { on: 'event'; name: string; source?: RecordId };                             // component/emit
type Action =                                         // FR-INT-002
  | { do: 'next' | 'prev' | 'back' | 'closeOverlay' | 'zoomOut' }
  | { do: 'navigate'; screen?: RecordId; step?: number; url?: string; transition?: TransitionSpec }
  | { do: 'openOverlay'; content: { screenId: RecordId } | { groupId: RecordId };
      position: 'anchored' | 'center' | 'drawer' | 'fullscreen'; anchor?: RecordId; modal?: boolean;
      dismiss?: ('outside' | 'esc')[]; transition?: TransitionSpec }
  | { do: 'show' | 'hide' | 'toggle'; targets: RecordId[]; transition?: TransitionSpec }
  | { do: 'play' | 'pause' | 'restart'; timeline: string }                      // named timeline (FR-TML-003)
  | { do: 'setScreenState'; state: string; transition?: TransitionSpec }       // FR-SCR-007
  | { do: 'setVar'; variable: string; value: Expr } | { do: 'incVar'; variable: string; by?: Expr }
  | { do: 'toggleVar'; variable: string }
  | { do: 'zoomTo'; target: RecordId; enterSubScreen?: boolean }
  | { do: 'riders'; connectorId: RecordId; op: 'start' | 'stop' | 'burst'; count?: number }
  | { do: 'emit'; name: string; payload?: Expr } | { do: 'call'; target: RecordId; method: string; args?: unknown[] }
  | { do: 'if'; cond: Expr; then: Action[]; else?: Action[] };
interface InteractionRecord extends BaseRecord { type: 'interaction'; ownerId: RecordId;
  trigger: Trigger; condition?: Expr; actions: Action[]; once?: boolean }
interface VariableRecord extends BaseRecord { type: 'variable'; name: string;
  valueType: 'string' | 'number' | 'boolean' | 'color'; default: string | number | boolean }
```

**Step semantics.** A *click group* is an `onClick` step plus the `withPrevious`/`afterPrevious`
steps that follow it. `onEnter` steps form group 0, which plays on screen entry. `onEvent` and
`onTime(at)` steps are gates like `onClick`. `next` also passes them, so builds stay navigable,
and they additionally advance on the named event or at `at` ms after screen entry (kiosk,
FR-PRS-007). Timelines other than `main` are named timelines played by actions; they have their
own clocks and are not part of the build position. **Magic move** matches `element.matchKey`
across screens. `screen.duplicate` sets `matchKey` to the source ID when it is absent, which
satisfies the "same ID across duplicates" rule (FR-TRN-002).

## 3. `@fluxion/anim`

```ts
interface BuildPos { screenId: RecordId; group: number; t: Ms }       // t within current group
interface CompiledScreen { groups: CompiledGroup[]; ambient: CompiledTrack[]; // riders, flows, infinite loops
  endStates: AnimState[];               // precomputed fold after each group (fast seek)
  named: Record<string, CompiledGroup[]>; }
interface AnimState {                   // overlay on top of records; render applies it
  el: Map<RecordId, { visible?: boolean; opacity?: number; tf?: Transform; fill?: string; stroke?: string;
    strokeWidth?: number; draw?: number; dashOffset?: number; path?: Path; textReveal?: number;
    vars?: Record<string, string> }>;
  riders: Map<RecordId, RiderSample[]>; screenState?: string; }

function compileScreen(snap: DocSnapshot, screenId: RecordId, fx: EffectRegistry, p: MotionPolicy): CompiledScreen;
function sample(c: CompiledScreen, pos: BuildPos, ambientT: Ms): AnimState;   // pure, O(active tracks)
function reduceBuild(c: CompiledScreen, group: number): AnimState;            // cumulative end state
```

1. **Build-state reducer**: `state(group, t) = endStates[group-1] ⊕ sample(group, t)`. Jumps,
   deep links and `prev` never replay intermediate animation (FR-TML-002/005). A property test
   checks that `next^n` then `prev^n` returns the initial state.
2. **Effect registry** (core `effects`): `EffectDef<P> { id, category, params: ZodType<P>,
   defaults: {duration, easing}, compile(anim, params, ctx) → Track[], reduced?(tracks) →
   Track[], maxFlashHz? }`. Presets (fade, fly-in, zoom, wipe, draw, pop, blur-in, typewriter,
   exits, pulse, shake, glow, color, animated border, motion-path, morph) compile to tracks.
   Packs add presets (FR-ANI-009), and the editor can "explode" a preset into editable
   `keyframes`.
3. **Interpolation**: numbers are lerped. Colors (including resolved `TokenRef`s) are
   interpolated in **OKLCH** via `theme`/culori, with shortest-arc hue and gamut mapping on
   output (FR-ANI-004). Transforms decompose into translate/scale/rotate. Easings are evaluated
   from the same baked `linear()` definitions that WAAPI receives.
4. **Morph** (FR-MRP-001/002): outlines are already cubic-normalized (03 §5). With the same
   subpath and segment counts, control points are lerped directly (fast path). Otherwise
   **flubber** is used (`interpolateAll`/`separate`/`combine` for 1↔N), with
   `maxSegmentLength` set per tier. Interpolators are built at screen preload, and the low tier
   bakes K = 30 frames. Text is never morphed; it cross-fades. Route changes use
   **d3-interpolate-path**, with endpoints pinned to the animated anchors (05 §8).
5. **Riders**: `buildLut(path, 2px) → {length, s, x, y, angle: Float32Array}`, rebuilt on route
   revision so riders follow live paths (FR-RDR-002).
   `distance(i, t) = (phase_i·L + speed·t) mod L`, with a binary-search lerp. Arrivals at `L`
   produce `riderArrive` events when `emitArrive` is set (FR-RDR-004).
6. **Expressions** (FR-DOC-009, FR-INT-004, NFR-SEC-007): a hand-written parser produces an AST
   once at load. The grammar has literals, `vars.*`, `state`, `step`, `screen`, `semantic.*`,
   arithmetic, comparisons, `&& || !`, ternary, and whitelisted pure functions (`min max abs
   round clamp`). There is no member access on arbitrary objects, no `eval`, and no functions
   as values. The evaluator enforces a step budget (default 10k nodes) and an optional deadline
   via the injected `Clock`. Violations become diagnostics, never exceptions into the frame.

## 4. `@fluxion/player` runtime

```
 keyboard · pointer/touch · clicker · remote/sync msgs · component emit · timers
        │ normalize (data-el-id delegation, swipe, long-press, 44px hit expansion)
        ▼
 TriggerBus ──▶ InteractionEngine (index by trigger+owner; condition via expr; vars store)
        ▲                │ actions (serial queue, cascade depth ≤ 32)
        │ events         ▼
        │     PresentationController {screen, group, history[], overlays[], camera, screenState, vars}
        │          │ position changes ──▶ SyncChannel (speaker / audience windows)
        │          ├──▶ TransitionManager (A→B, magic move, zoomInto, overlay enter/exit)
        │          └──▶ TimelineScheduler ◀── Clock (realtime rAF | controlled | virtual)
        │                    │ state = anim.sample(...)  (diff vs previous frame)
        └────────────────────┤──▶ WAAPI driver     (transform, opacity, offset-distance)
                             ├──▶ rAF sampler      (d, dashoffset, SVG fill/stroke, CSS vars, text reveal)
                             └──▶ rider backend    (DOM offset-path | canvas | OffscreenCanvas worker)
                                        ▼
                             render: <ScreenView animState handles> (04 §2.2)
```

### 4.1 Clock & scheduler
The `Clock` port has three implementations: realtime (`performance.now` + rAF), **controlled**
(the editor sets time), and **virtual** (tests and export). One rAF loop serves all main-thread
sampling. It samples, diffs the state, and writes via `ElementHandle` (reads never happen in
the loop). Starting a new group while one runs **finishes** the running group first (jump to
end).

### 4.2 WAAPI vs rAF
Compositor properties on element wrappers are driven by paused WAAPI `Animation`s built from the
same tracks and eased with the baked `linear()`. The scheduler sets `currentTime` on seek, and
the animations keep running smoothly during main-thread jank. SVG attributes and anything not
compositable go through the rAF sampler. `will-change` is added only for an animation's
lifetime (research 03 §8.1).

### 4.3 Riders
Up to about 50 riders per screen, plus any interactive rider, are DOM elements using
`offset-path: path(...)` with WAAPI on `offset-distance` and `offset-rotate: auto`. Above that,
the riders layer `<canvas>` draws all non-interactive riders from LUTs, batched per style with
DPR capped at 2. Where supported, `transferControlToOffscreen()` moves drawing to a worker
(created from a Blob URL in `.flux.html`). The main thread posts time plus transferable LUT
buffers, and the fallback is a main-thread canvas. Target: 500 riders at 60 fps desktop and 200
at 55 fps on mobile (FR-RDR-005).

### 4.4 Controller, transitions, overlays
- `next()` plays the next group; at the end it navigates by `screen.next` or document order
  (FR-PRS-003). `prev()` seeks to the previous group's end state. `back` pops `history`
  (FR-INT-006). `zoomTo` + `enterSubScreen` pushes a sub-screen with a breadcrumb (FR-INT-007).
- The **TransitionManager** keeps current, incoming and a preloaded next screen mounted.
  Preloading builds the DOM hidden, creates morph interpolators and LUTs, and runs
  `img.decode()`. Magic move computes from/to transforms from **model geometry** (no DOM
  measurement), morphs geometry when `morphShapes` is set, fades unmatched elements, and
  re-routes connectors from the interpolated endpoints. The View Transitions API is an optional
  enhancement for DOM-heavy screens only.
- **Overlays** (FR-INT-003) render in the overlays layer. Modal overlays use
  `<dialog>.showModal()` (native focus trap, `inert` background, Esc). Anchored or non-modal
  overlays use the `popover` attribute and are positioned from the anchor element's model box.
  Focus returns to the trigger on close (NFR-A11Y-004). Enter and exit use the overlay's
  `TransitionSpec`.

### 4.5 Deep links & history
`#/<screenId>/<group>` (FR-PRS-005). Loading a link seeks `reduceBuild(group)` with no
intermediate animation (FR-TML-005). Screen changes `pushState`, and step changes
`replaceState`. Variables and overlays are session state and not part of the URL.

### 4.6 Speaker view & sync (FR-SPK-001)
```ts
interface SyncChannel { post(m: SyncMsg): void; on(cb: (m: SyncMsg) => void): Unsubscribe }
type SyncMsg = { v: 1; from: string; seq: number } & (
  | { type: 'pos'; pos: BuildPos } | { type: 'hello' | 'heartbeat' }
  | { type: 'pointer'; x: number; y: number /* normalized screen coords */ } | { type: 'blank'; color: 'black' | 'white' | null });
```
The channel is `BroadcastChannel('fluxion:' + docHash)` when the origin is usable. On `file://`
(opaque origins) it falls back to `postMessage` between the `window.open()` opener and the
opened window. The last writer wins by `(seq, from)`, and messages apply within 100 ms. The
speaker window renders the current and next group with a virtual clock, plus notes, timer and
clock. Laser, ink and blackout are overlay layers that never mutate the document (FR-PRS-008).

### 4.7 Motion policy, visibility, tiers
- **Reduced motion** (FR-ANI-008, NFR-A11Y-003): `document.settings` sets a policy (`respect`
  the OS / always reduce / always full), and the player toggle overrides it, giving
  `MotionPolicy = 'full' | 'reduced' | 'none'`. Under `reduced`, movement, zoom and morph become
  fades ≤ 200 ms (the effect's `reduced()` variant), and ambient loops, riders and flows become
  static direction cues. `essential` animations play simplified. Validation rejects effects over
  3 flashes/s, and any motion over 5 s has a pause control.
- **Pause when hidden** (FR-ANI-007, NFR-PERF-008): `visibilitychange` stops the rAF loop,
  pauses WAAPI and signals the rider worker. In scroll/site mode an IntersectionObserver pauses
  off-screen screens.
- **Performance tiers**: the initial guess comes from `hardwareConcurrency`/`deviceMemory`. Frame
  times are then measured over the first second of each screen, and a p90 above 20 ms steps
  down one tier. `high` = all effects. `medium` = baked morph frames, canvas riders, DPR 1.5,
  no trails. `low` = fades only, static flow arrows, riders off unless `essential`. The editor
  can preview each tier (NFR-PERF-004).

### 4.8 Edit-mode preview
The editor mounts the same `PresentationController` on a read-only store view with the
**controlled** clock. Timeline scrubbing calls `seek`, "preview interactions" routes canvas
clicks to the TriggerBus, and the interaction debugger (FR-INT-011) subscribes to the bus and
the variables store. No separate preview code path exists (04 §3.8).

## 5. `<fluxion-player>` web component (FR-PRS-009)

```ts
// <fluxion-player src="deck.flux" start="#/s2/1" controls autoplay loop
//                 mode="fixed|reflow|scroll" motion="auto|reduced|none" sync="speaker">
interface FluxionPlayerElement extends HTMLElement {
  load(src: string | Blob | ArrayBuffer | FluxJson): Promise<void>;
  next(): void; prev(): void; goTo(screen: string | number, group?: number): void;
  play(timeline?: string): void; pause(): void;
  getVariable(name: string): unknown; setVariable(name: string, value: unknown): void;
  openSpeakerView(): Window | null;
  readonly position: { screenId: string; screenIndex: number; group: number; groupCount: number };
  readonly screens: ReadonlyArray<{ id: string; name: string }>;
}
// events (CustomEvent, bubbles): 'fluxion-ready', 'fluxion-position', 'fluxion-screen',
// 'fluxion-interaction' {ruleId}, 'fluxion-event' {name, payload}, 'fluxion-error' {diagnostic}
```

It uses shadow DOM with content CSS adopted from `render`, and chrome is styleable via `::part()`.
`@fluxion/player/react` exports a thin `<FluxionPlayer>` wrapper. The `.flux.html` bootstrap
mounts one full-page `<fluxion-player>` over the embedded payload.

## 6. Testing
- `anim` (pure, ≥ 90 % coverage): tests per effect at t = 0/50/100 %, OKLCH interpolation,
  morph fixtures (rect→star has no self-intersection at key frames), LUT accuracy ±0.5 px
  (FR-ANI-005), build fold property tests, and expression fuzzing (step limit, no escapes).
- `player`: trigger and action unit tests with the virtual clock (FR-INT-001/002), deep link ≡
  stepping, speaker sync over a mocked channel and `postMessage` fallback, reduced-motion E2E,
  CPU-idle-when-hidden perf test, rider benchmark (FR-RDR-005), and axe checks on overlays.
