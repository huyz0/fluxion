# Editor accessibility checklist

What a change to the editor's chrome keeps true (NFR-A11Y-001). Each line names how it is checked; a line with no check is a
manual step for the person reviewing the change.

## Automated

- **No serious or critical axe finding** in any state: the document as it opens, a selection, the element context menu, the font
  picker on each of its tabs, the keyboard shortcuts dialog and the command palette. `e2e/a11y.editor.spec.ts`, on Chromium, Firefox
  and WebKit; the shell's own states (timeline, image picker, presenting) are in `e2e/a11y.editor-shell.spec.ts`.
- **Every story passes axe**: each `*.stories.tsx` is rendered and checked by its `*.stories.browser.test.tsx` (portable stories,
  ADR-0139). A new story is tested without a new test.
- **Contrast**: text on the chrome's backgrounds is at least 4.5:1. The command palette's selected row (white on the accent colour)
  included: its faded shortcut hint failed at 3.9:1 and is no longer faded. axe's `color-contrast` rule runs in the specs above, with the
  palette open, with a query that finds nothing, and over the context menu.
- **Roles**: a listbox holds options only; the command palette's "No command matches" line is a `role="status"` outside it (it was inside, which axe flags as `aria-required-children`).
- **Themes**: each theme of the themes pack has text and muted colours at 4.5:1 on its background and surface (the high-contrast
  theme at 7:1) and the connector at 3:1 (`packs/themes-core`, `contrastRatio`).

## Keyboard

- Every control is reachable and operable with the keyboard: the toolbar buttons and selects, the panels' tabs and lists, the
  dialogs. The Fonts button opens its dialog with Enter; Esc closes it and returns focus to the button.
- A modal dialog (keyboard shortcuts, fonts, image picker) takes focus when it opens and keeps Tab inside it; keys typed in it
  are not the canvas's (undo does not act behind a dialog). `dialog-keys.ts` holds the shared rule.
- Every action has a shortcut or a command-palette entry; shortcuts are listed in the keyboard shortcuts dialog (`?`) and can
  be rebound.

## Focus

- Focus is always visible (the chrome's focus ring uses `--ui-focus`, 3:1 against its surroundings).
- Opening a dialog moves focus into it; closing it returns focus to what opened it (the Fonts button does; the others are a
  manual check).

## Labels and structure

- Every control has an accessible label: icon-only buttons carry `aria-label` or a `title`; a select is named by its own
  `aria-label` (Theme, Screen theme), not by its options.
- The toolbar, canvas and panels are named landmarks (banner, main, complementary); a dialog is `role="dialog"` with
  `aria-modal` and a name; tabs are `role="tab"` in a named tablist with `aria-selected`.
- Status text a person needs after an action is a live region (`role="status"`, as the font picker's message); an error that
  blocks (a catalog that did not load) is `role="alert"`.
- Colour is never the only signal: a pressed button is `aria-pressed`, a selected tab `aria-selected`.

## Manual, with every release

- Walk the editor with a screen reader (VoiceOver and NVDA): the toolbar, a dialog, the inspector.
- Zoom the page to 200 % and check that no control is clipped and no dialog is taller than the window (the font picker scrolls).
- Roving focus and arrow keys in the font picker's tabs, and in the toolbar's groups, are not done: each tab is a Tab stop.
