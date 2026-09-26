---
name: ui-check
description: Prove a visible or interactive change works in the real studio/player, not just in unit tests. Use when a task changes rendering, editor interaction, present-mode behaviour, animation, responsive layout, or anything a user sees or touches.
---

# UI check

Standards: `docs/standards/design-ui.md`, `docs/standards/testing.md` (T2/T3).

## Steps

1. **Encode the acceptance as a Playwright test** (T2) under the owning app/package's `e2e/`
   folder, named with the requirement ID, using page objects from `e2e/support/`. Use the
   deterministic fixture set: `examples/fixtures/*.flux.json`, fixed viewport, embedded fonts,
   `VirtualClock` exposed via `window.__fluxion.clock` in test builds.
2. **Visual assertions** (T3) only when pixels are the requirement: screenshot within the pinned
   Playwright Docker image (`pnpm e2e:visual`), or prefer normalized SVG/DOM snapshots which are
   OS-independent.
3. **Edit/present parity**: if the change renders content, add or extend the parity test
   (same screen, edit vs present, overlay hidden → pixel diff ≤ threshold `PARITY_MAX_DIFF`).
4. **Accessibility**: run the axe check helper on the touched view; zero serious/critical.
5. **Look at it**: run the studio (`pnpm --filter studio dev`), open the fixture, perform the
   flow, and capture a screenshot to `.harness/artifacts/<ID>/` (gitignored). If your tool has a
   browser, use it; otherwise rely on the Playwright trace (`--trace on`) and inspect it.
6. **Mobile**: if player behaviour changed, run the Playwright `mobile` project (Pixel/iPhone).
7. **Reduced motion**: if animation changed, run with `reducedMotion: 'reduce'` as well.

## Report

Paste the Playwright summary line(s) and the paths of screenshots/traces into the transcript.
Never describe what the UI "should" look like as evidence — only what was observed.
