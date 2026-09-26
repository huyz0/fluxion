# 16 — Player, Presentation & Responsive

Areas: `PRS` (present mode), `SPK` (speaker tools), `RSP` (responsive/mobile).

## PRS — Present mode

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-PRS-001 | M | R1 | Full-screen presentation (Fullscreen API) with letterboxing to preserve aspect ratio; background color configurable. | 16:9 on 16:10 display letterboxes. |
| FR-PRS-002 | M | R1 | Navigation: next/prev (arrows, space, PgUp/PgDn, click, clicker devices), first/last (Home/End), go to screen number (type + Enter), overview grid (`O`/`Esc`). | E2E per key. |
| FR-PRS-003 | M | R1 | "Next" advances through build steps before advancing screen; "prev" reverses. | E2E. |
| FR-PRS-004 | M | R1 | Present mode **blocks editing**: no selection, no handles, no drag-mutations; only interactions defined in the doc. | E2E assertion: doc unchanged after random input fuzzing. |
| FR-PRS-005 | M | R1 | Deep links: URL hash `#/screen-id/step` restores position; history API integration. | Reload preserves position. |
| FR-PRS-006 | S | R1 | Progress indicator, screen counter, optional auto-hide controls bar. | Snapshot. |
| FR-PRS-007 | S | R4 | Auto-advance (kiosk) with per-screen durations, loop. | Timed E2E with fake clock. |
| FR-PRS-008 | S | R5 | Presenter tools: laser pointer, spotlight, ink/drawing annotations (ephemeral), zoom lens, blackout (`B`)/whiteout (`W`). | E2E. |
| FR-PRS-009 | M | R1 | The player is embeddable (`<fluxion-player src=…>` web component and React component) with API: `goTo`, `next`, `prev`, events. | Embed example works in plain HTML page. |

## SPK — Speaker view

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-SPK-001 | M | R5 | Speaker view in second window: current + next screen/step, notes, timer, clock; sync via BroadcastChannel. | Navigating in either window syncs within 100 ms. |
| FR-SPK-002 | S | R5 | Remote control from phone over local network or WebRTC pairing (QR code). | Phone next → presentation advances. |
| FR-SPK-003 | S | R5 | Rehearse mode: record timings per screen. | Timings saved in doc. |

## RSP — Responsive & mobile

| ID | Pri | Inc | Requirement | Acceptance criteria |
|---|---|---|---|---|
| FR-RSP-001 | M | R1 | Mobile viewing: scaled-to-fit screen, swipe left/right to navigate, tap to advance build, pinch-zoom & pan into screen, double-tap to fit. | E2E with mobile emulation (iPhone, Pixel). |
| FR-RSP-002 | M | R7 | **Responsive modes** per doc/screen: `fixed` (scale to fit), `reflow` (alternative layout per breakpoint), `scroll` (vertical stacked screens like a web page). | Portrait phone renders chosen mode correctly. |
| FR-RSP-003 | M | R7 | Breakpoint overrides: per breakpoint (e.g. `portrait`, `narrow`), elements may override position/size/visibility/font scale, or a layout may be re-run with different direction. | Override applied only at breakpoint. |
| FR-RSP-004 | S | R7 | Auto-generate portrait variant of a landscape screen (AI-assisted or heuristic re-layout: stack, re-layout LR→TB, scale text for readability ≥ 14 px effective). | Generated variant has no overlap and min font rule holds. |
| FR-RSP-005 | M | R7 | Editor preview of breakpoints (device frames) with override editing. | Edit in portrait preview writes override, not base. |
| FR-RSP-006 | S | R7 | Scroll-driven mode: builds/animations triggered by scroll position (scrollytelling). | Scrolling triggers steps. |
| FR-RSP-007 | M | R1 | Orientation change & resize handled without reload; state (screen/step) preserved. | E2E. |
