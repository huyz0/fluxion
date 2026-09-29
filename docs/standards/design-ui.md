# Design — editor & player UI

> Read when: building or changing any editor panel, tool, dialog, overlay, player control or
> UX copy; adding a Storybook story; touching focus, motion or keyboard handling.
> Family: Design · Related: [coding-typescript.md](coding-typescript.md), [performance.md](performance.md),
> ADR-0010 (styling isolation), ADR-0029 (editor chrome primitives).

Fluxion has two visual worlds: **editor chrome** (our UI) and **content** (the user's deck,
styled by the document theme). This standard governs the chrome and the player controls; it
never dictates how a deck looks.

## 1. Principles

| Principle | Means in practice |
|---|---|
| **Content first** | Chrome recedes: neutral palette, no chrome colour inside the canvas except selection/guide accents. Panels collapse; canvas gets the space. |
| **WYSIWYG parity** | The canvas uses the same `<ScreenView>` as the player (FR-EDT-010). If edit and present differ by a pixel, it is a bug. |
| **Progressive disclosure** | Common properties up front; advanced ones behind "More" or in the inspector's secondary tab. No modal for anything that can be inline. |
| **Keyboard-first** | Every action is a command with an ID, reachable from the command palette and bindable. Mouse is optional for everything except free drawing. |
| **AI-first flows** | Prompting, reviewing and accepting AI changes is a primary path: AI edits arrive as a previewable diff (accept / reject / undo as one step), never silently. |

1. **Every new user action is registered as a command** (`fluxion.align.left`) with label,
   keybinding (optional) and palette entry. → registry test in `editor` (every command has label + palette entry)

## 2. Tokens: chrome vs document

| | Editor chrome | Document / player content |
|---|---|---|
| Source | `--ui-*` custom properties: the chrome stylesheet in M6, Tailwind v4 `@theme` from M7 (ADR-0029) | `theme` package tokens → `--fx-*` custom properties |
| Styling | M6: `CHROME_CSS` in `@layer fx.chrome` under `.fx-editor`; from M7: Tailwind utilities + shadcn/ui (Base UI), no preflight (ADR-0029) | content CSS strings (`fx-` classes, `@layer fx.content`; ADR-0015) |
| Light/dark | follows OS + user setting | follows deck theme only |

2. **Chrome never uses `--fx-*`; content never uses Tailwind or `--ui-*`.** → `check-layering`
   (no `tailwind` import in `render`/`player`) + Biome restricted imports
3. **No raw colours, radii or spacing values in chrome** — use tokens. → Biome GritQL
   plugin (hex / arbitrary px values in `className`) + review
4. **Contrast**: chrome text ≥ 4.5:1, UI boundaries and focus rings ≥ 3:1, in both modes. →
   Storybook a11y addon (axe)

## 3. Editor layout

```
┌──────────────────────────── top bar: file · undo/redo · mode · share · AI ──┐
│ left rail   │                                            │ inspector       │
│ screens /   │               canvas (ScreenView           │ (selection      │
│ layers /    │               + edit overlay)              │  properties)    │
│ library     │                                            │                 │
├─────────────┴──────── bottom: timeline / interactions (collapsible) ───────┤
```

5. **Panels are resizable and collapsible; state persists per user.** Canvas min width 480 px.
   → no gate — judgement
6. **Floating toolbars attach to the selection**, never cover it, and flip at viewport edges.
   → no gate — judgement

## 4. Interaction

7. **Direct manipulation first**: move, resize, rotate, connect and edit text on canvas; the
   inspector mirrors, it doesn't replace. → E2E flows
8. **Handles are screen-space** (constant size at any zoom), hit area ≥ 24×24 CSS px
   (WCAG 2.5.8). Visible handle may be smaller. → overlay unit test on hit areas
9. **Guides and snapping** show on drag with a distance label; `Alt` suspends snapping. → E2E
10. **Feedback latency**: visual response to input < 100 ms; drag at ≥ 55 fps (NFR-PERF-001).
    Anything slower shows progress within 400 ms. → perf E2E
11. **Every change is undoable as one step per gesture**; destructive actions prefer undo over
    confirmation dialogs. → property test on command history
12. **Hover reveals, never hides**: nothing disappears on hover; tooltips show command name +
    shortcut after 500 ms. → no gate — judgement

## 5. Iconography

13. **Lucide only**, 16 px in dense panels, 20 px in toolbars, stroke 1.5–2, `currentColor`.
    Icon-only buttons have an accessible name and tooltip. → axe (button-name)
14. Custom icons follow Lucide grid (24 px, 2 px stroke, round caps) and live in
    `apps/studio/src/icons/`. → no gate — judgement

## 6. Motion (UI only; deck animation is the user's)

| Use | Duration | Easing |
|---|---|---|
| Hover / press state | 80–120 ms | `ease-out` |
| Popover, menu, tooltip | 120–180 ms | `cubic-bezier(0.2, 0, 0, 1)` |
| Panel / drawer | 200–250 ms | same |
| Canvas camera (zoom-to-fit) | 250–350 ms | `cubic-bezier(0.3, 0, 0, 1)` |

15. **Animate only `transform` and `opacity`.** → `performance.md` rule
16. **`prefers-reduced-motion: reduce` → durations 0 (or cross-fade ≤ 100 ms)** for chrome and
    player controls; the player also honours it for deck effects (NFR-A11Y-003). → E2E with
    emulated media
17. **Motion never blocks input**; interrupted animations jump to end state. → E2E

## 7. Accessibility (WCAG 2.2 AA)

18. **Everything is keyboard operable; focus is always visible** (2 px ring, `:focus-visible`,
    not obscured by panels). → axe in Playwright: 0 serious/critical (NFR-A11Y-001)
19. **Use Base UI primitives** for menus, dialogs, tabs, comboboxes; don't hand-roll ARIA
    patterns that exist there. → review
20. **Canvas pattern**: the canvas is a `role="application"` region with an accessible name;
    elements are a **roving-tabindex** list (Tab enters, arrows move between elements in reading
    order, Enter edits, Esc exits). Selection changes are announced in a polite live region
    ("Rectangle 'Start' selected, 3 of 12"). → keyboard E2E
21. **Player**: each screen exposes headings, lists, alt text and connector relationships as text
    ("A connects to B: approves"); screen changes announced via live region; popups trap and
    restore focus (NFR-A11Y-002/004). → axe + keyboard E2E
22. **Dialogs return focus** to the invoking control on close. → Storybook play tests

## 8. i18n

23. **No user-visible string literals in JSX**; use Lingui `<Trans>`/`t` with ICU plurals. →
    Lingui lint (NFR-I18N-001)
24. **Layouts survive +40 % text length and RTL**: logical CSS properties
    (`margin-inline-start`), no fixed-width text buttons, icons that imply direction are
    mirrored. → pseudo-locale Storybook run
25. **Never concatenate translated fragments**; format numbers/dates with `Intl`. → review

## 9. UX copy

26. **Voice**: plain, short, sentence case, no blame, no jargon ("record", "tx" never shown).
    → no gate — judgement
27. **Error messages** say what happened, why if known, and what to do next; they show the
    `FluxError` code in a copyable detail line. → review (codes from `schema/src/errors.ts`)

```
✅ Couldn't open "Q3 plan.flux" — the file is damaged. Try "Recover" to salvage 18 of 20 screens.
❌ Error: FORMAT_ZIP_CORRUPT
```

28. **Empty states** explain the area and offer the primary action (and an AI prompt where it
    fits): "No screens yet. Add a screen or describe your deck to AI." → `empty` story required
29. **Buttons are verbs** ("Export PDF", not "OK"). Destructive actions name the object. → no
    gate — judgement

## 10. Responsive editor

30. **≥ 1280 px**: full layout. **768–1279 px**: inspector becomes an overlay drawer; left rail
    collapses to icons. **< 768 px**: view, present and comment only; editing tools hidden with
    an explanatory banner. → Playwright viewport matrix
31. **Touch**: pinch-zoom and two-finger pan on canvas; targets ≥ 24 px (44 px on touch-only
    controls in the player). → Playwright mobile project

## 11. Storybook and visual regression

32. **One story per component state**: default, hover/focus (via play), disabled, loading,
    empty, error, long text, RTL, dark. Stories are Vitest browser tests: a sibling `*.browser.test.tsx` composes every story (portable stories, until addon-vitest supports Vitest 5; ADR-0139). →
    story-coverage test in `editor` (every exported component has a `*.stories.tsx`)
33. **Visual snapshots** (`toMatchScreenshot`) only in the pinned Playwright Docker image; update
    with `-u` only intentionally and say why in the PR. → CI `visual` job
34. **Renderer components** get structural SVG/DOM goldens before pixel tests. → Vitest
    `toMatchFileSnapshot`
