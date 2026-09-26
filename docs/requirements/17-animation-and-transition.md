# 17 — Animation & Transition

Areas: `ANI` (element animation & effects), `TML` (timelines/builds), `TRN` (screen transitions),
`MRP` (morph), `FLW` (connector flows). Riders are in `12` (`RDR`).

Principle: **all motion is declarative data** (JSON-serializable, AI-generatable), executed by
one player runtime; React component elements can additionally run their own logic but expose
it through the same trigger/action contracts.

## ANI — Element animations & effects

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-ANI-001 | M | R4 | Animation = target element(s) + effect + params (duration, delay, easing, iterations, direction, fill) — all serializable. | Schema validates; runtime executes deterministically with a virtual clock. |
| FR-ANI-002 | M | R4 | **Entrance** effects: appear, fade, fly-in (direction), zoom, wipe, draw (stroke reveal), pop/bounce, blur-in, typewriter (text). | Snapshot at t=0/50/100 %. |
| FR-ANI-003 | M | R4 | **Exit** effects: mirror of entrance set. | Snapshots. |
| FR-ANI-004 | M | R4 | **Emphasis** effects: pulse, grow/shrink, spin, shake, wiggle, color change (fill/stroke/text), border effects (glow, animated dash, gradient sweep, "breathing" outline), highlight, blink, opacity. | Snapshots; color interpolation in OKLCH. |
| FR-ANI-005 | M | R4 | **Motion path** effect: move element along a path (drawn or an existing connector's path), rotate-to-path. | Element position at t equals path point at t (±0.5 px). |
| FR-ANI-006 | M | R4 | **Property keyframes**: animate any numeric/color/token property of an element with keyframes & per-segment easing (custom cubic-bezier, spring). | Keyframe interpolation unit tests. |
| FR-ANI-007 | M | R4 | Looping/ambient animations (run continuously while screen visible), paused when screen hidden or tab inactive. | CPU idle when hidden (perf test). |
| FR-ANI-008 | M | R4 | Respect `prefers-reduced-motion`: replace motion with fades or disable ambient loops (per-doc policy). | E2E with emulated reduced motion. |
| FR-ANI-009 | S | R4 | Effect presets library (pack-extensible) with preview thumbnails. | Custom effect from pack usable. |
| FR-ANI-010 | S | R4 | Lottie/dotLottie and Rive assets as animated elements controllable by triggers (play, pause, segment, state-machine input). | Trigger plays Lottie segment. |
| FR-ANI-011 | M | R4 | Edit-mode preview: play element/step/screen, scrub timeline, loop preview; edit mode shows final state by default with "preview" toggle. | E2E. |

## TML — Timelines / builds

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-TML-001 | M | R4 | Each screen has an ordered **build sequence** of steps; each step holds one or more animations with trigger `onClick` (next), `withPrevious`, `afterPrevious (+delay)`, `onEvent(name)`, `onEnter` (screen), `onTime(t)`. | Sequence runs per trigger semantics (unit tests with virtual clock). |
| FR-TML-002 | M | R4 | Build steps are navigable forward/backward; backward restores exact prior state (reversible). | Property: next^n then prev^n restores initial state. |
| FR-TML-003 | S | R4 | Named timelines (non-linear) triggered by interactions, independent of main build. | Interaction plays a named timeline. |
| FR-TML-004 | S | R4 | Timeline panel UI: gantt-like tracks, drag to retime, easing editor. | E2E. |
| FR-TML-005 | M | R4 | Jumping to a screen/step directly (deep link, overview) renders the correct cumulative state without playing intermediate animations. | Deep link to step 5 renders same as stepping 1..5. |

## TRN — Screen transitions

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-TRN-001 | M | R4 | Transitions between screens: none, fade, slide (4 dirs), push, cover/uncover, zoom, flip, dissolve; duration & easing. | Snapshot mid-transition. |
| FR-TRN-002 | M | R4 | **Magic move / morph transition**: elements sharing a `matchKey` (or same ID across duplicated screens) animate position, size, rotation, style, and geometry between screens; others fade. | Matched element tweens; unmatched fade. |
| FR-TRN-003 | S | R5 | **Zoom transition** into a shape/sub-screen and out (Prezi-like spatial navigation). | Zoom into container reveals sub-screen. |
| FR-TRN-004 | S | R4 | Per-direction transitions (different for forward/back) and per-link overrides (interaction navigation). | E2E. |

## MRP — Morph

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-MRP-001 | M | R4 | Shape **geometry morph**: animate between any two shape outlines (different point counts & types), used by morph transitions and emphasis "morph into shape X". | Morph rect→star has no self-intersection artifacts at key frames (visual check fixture). |
| FR-MRP-002 | S | R4 | Morph text content (cross-fade/char morph) and connector route morph (interpolate old → new path). | Connector route tweens after layout change. |

## FLW — Connector flow effects

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-FLW-001 | M | R4 | Connector effects: draw-on (stroke reveal from source to target), flowing dashes ("marching ants") with speed/direction, pulse travelling along the line, glow, color sweep. | Snapshots at t. |
| FR-FLW-002 | M | R4 | Flow direction follows connector direction; reverse option; bi-directional. | Unit test. |
| FR-FLW-003 | S | R4 | Flow intensity bound to data (speed/width from semantic or variable values). | Changing variable changes speed. |
