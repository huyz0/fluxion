---
status: accepted
date: 2026-09-30
decision-makers: Fluxion maintainers (M6.3, delegated to the driver)
amends: ADR-0010 (when Tailwind and shadcn/Base UI enter the editor chrome, and without Tailwind's base reset)
---

# ADR-0029 — Editor chrome primitives: own splitters, a scoped chrome stylesheet, the panel layout in a settings port

## Context and Problem Statement

M6 builds the editor chrome (FR-EDT-001):
- a top toolbar;
- left tabs (screens, library and layers placeholders);
- the canvas;
- a right inspector placeholder;
- a collapsible bottom timeline.
Panels resize and hide, focus mode hides them all, and the layout persists per user. ADR-0010
chose Tailwind v4 with shadcn/ui on Base UI for editor chrome, and content CSS in its own layers.
M6.md asks three things before coding:
1. how panels and splitters are built (`react-resizable-panels` or Base UI plus an own splitter);
2. how the chrome is styled inside ADR-0010 without touching rendered content;
3. where the panel layout persists.

## Decision Drivers

- FR-EDT-001: resizable, hideable panels, focus mode, a layout persisted per user.
- FR-EDT-010: edit and present draw the same content pixels. Nothing from the chrome may reach the
  content layer; a CSS reset such as Tailwind's preflight would (`svg`, `img`, `p` margins).
- NFR-A11Y-001: panels and splitters are operable by keyboard and named for assistive technology
  (the axe leg of M6).
- No new runtime dependency without a reason (non-negotiable 8); `EDITOR_INITIAL_GZIP` budget.
- M6's chrome has no composite widget (menu, dialog, popover, combobox). Those arrive in M7 with
  the inspector, context menus and the command palette.

## Considered Options

- **Splitters:** (A1) an own `PanelGroup`/`Splitter` following the WAI-ARIA window splitter
  pattern; (A2) `react-resizable-panels`.
- **Styling in M6:** (B1) a chrome stylesheet string in `@layer fx.chrome`, scoped under the
  editor root class, with native elements and roles; Tailwind v4 and shadcn/Base UI enter with the
  first composite widget (M7), without Tailwind's base reset; (B2) Tailwind v4 and shadcn from M6,
  as ADR-0010 reads.
- **Persistence:** (C1) a `SettingsStore` port (get/set JSON by key) injected by the host, with
  the studio adapter on `localStorage`; (C2) `localStorage` called directly from the editor.

## Decision Outcome

Chosen: **A1, B1, C1**.

1. **Splitters are own components.** A `PanelGroup` lays out sized panels, and a `Splitter` between
   two of them has `role="separator"`, `aria-orientation`, `aria-valuenow`/`min`/`max` and an
   accessible name. It resizes by pointer drag and by arrow keys (10 px, shift 50 px). Enter
   collapses or restores a panel. Sizes are clamped to each panel's minimum and maximum.
2. **The chrome is styled by a scoped stylesheet.**
   - `CHROME_CSS` is a string in `@layer fx.chrome`, injected once like render's content CSS
     (ADR-0015). The canvas's `.fx-view` sits inside `.fx-editor`, so scoping by ancestor is not
     enough. Every selector's last compound therefore names a chrome class (`fx-editor`, or one
     starting `fx-chrome-`): no element or attribute selector reaches an element by itself, so no
     rule can match content (M6.3 review r2 F1). A T0 test on `CHROME_CSS` checks every selector.
   - Colours and sizes are `--ui-*` custom properties with light and dark values.
   - M6 uses native elements: buttons, a `tablist`, `aside` and `main` landmarks.
   - ADR-0010's Tailwind v4 with shadcn/ui on Base UI remains the chrome system. It enters with
     the first composite widget (M7). It imports Tailwind's theme and utilities, never its base
     reset (preflight), so no rule outside the chrome's own classes changes.
3. **The layout persists through a settings port.**
   - The editor reads and writes its layout (panel sizes, collapsed panels, focus mode) through
     `SettingsStore { get(key): unknown; set(key, value): void }`, under the key
     `fluxion.editor.layout.v1`.
   - Values are validated and clamped on read; a missing or broken value gives the defaults.
   - The studio supplies a `localStorage` adapter, which is per user and per browser profile.
     Tests supply a memory store.

### Consequences

- Good, because M6 adds no chrome dependency, and a splitter's keyboard and ARIA behaviour is
  tested directly (T0 for the sizing math, T1 and E2E for the DOM).
- Good, because content never sees a chrome rule or a reset: parity (FR-EDT-010) does not depend
  on the order of third-party layers.
- Good, because layout persistence is testable without a browser and replaceable later (sync of
  user settings is a later requirement).
- Bad, because the M6 chrome styles are hand-written CSS, which the M7 move to Tailwind utilities
  rewrites.
- Bad, because owning the splitter means owning its edge cases (RTL, nested groups), which a
  library would already handle.

### Confirmation

The m6-complete legs:
- the E2E `editor.layout-persists.spec.ts` (a resized panel keeps its width across a reload);
- the E2E `a11y.editor-shell.spec.ts` (axe with no serious or critical finding);
- the parity leg (edit and present content within `PARITY_MAX_DIFF_PCT`).
`check-licenses` shows no new dependency.

## Pros and Cons of the Options

- **A2 `react-resizable-panels`**: mature, keyboard accessible, handles collapse and persistence;
  but a dependency for a three-panel layout, and its persistence API writes to `localStorage` on
  its own.
- **B2 Tailwind and shadcn from M6**: follows ADR-0010 to the letter, but brings a Vite plugin to
  the studio and Storybook, and a class scanner that must see the editor's source. Its preflight
  must be excluded by hand, all for widgets M6 does not have.
- **C2 `localStorage` directly**: less code, but the editor package would touch a browser global
  its tests cannot replace, and a later settings sync would have to find every call.

## More Information

ADR-0010 (styling isolation; its chrome system is kept, and this ADR sets when it enters and
excludes the reset); ADR-0015 (CSS strings injected once); 04 §3.4 (panels register in `panels`
with slot and order; the layout persists per user).
