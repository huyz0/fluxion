---
title: Themes & fonts
description: Switch the theme of a document or of one screen, read and extend the token model, choose a font from the bundled, Google Fonts or uploaded sources, and know where the document's metadata lives.
---

This guide covers how a document looks: its **theme** and the **tokens** behind it, the **fonts** its text is set in, and the
**metadata** it carries. Open any example in the studio (for instance `example-shapes-gallery`) to follow along.

## Themes

A theme is a named set of design tokens: the colours, type, spacing, radii, shadows and motion every element's style falls back
to. The studio ships eight: `light`, `dark`, `corporate`, `vibrant`, `pastel`, `high-contrast`, `blueprint` and `chalkboard`. The
text and background colours of each meet WCAG AA contrast (4.5:1; the high-contrast theme 7:1).

- The **Theme** menu in the toolbar changes the theme of the whole document. Every screen is restyled, and one undo restores the
  previous theme.
- The **Screen theme** menu sets an **override** for the screen you are looking at. That screen keeps its own theme when the
  document's theme changes; choose *Follows the document* to remove the override.

A theme you choose is **copied into the document** as a theme record (`theme-dark`, `theme-high-contrast`, ...), so a saved
document does not depend on the studio's list. Choosing the same theme again reuses the copy and never overwrites it, so edits you
made to the copy are kept.

## Tokens

A theme is a tree of tokens in the shape of the W3C design-token format: each token has a `$type` and a `$value`. A theme must
define these colour roles under `color`: `background`, `surface`, `text`, `muted`, `primary`, `secondary`, `accent-1` to
`accent-6`, `success`, `warning`, `danger`, `info` and `connector`. It may add any other tokens: dimensions (`radius`,
`spacing`), font families, font weights, shadows, durations and cubic-bézier curves.

An element's style refers to a token by name, for example a fill of `{color.primary}`. When the theme changes, everything that
refers to it follows.

### Aliases and derived colours

A colour token's value may be another token, `{color.primary}`: the colour of `primary`, followed to the end of the chain. A
colour may also be **derived** from another with a list of steps in `$extensions["dev.fluxion"].transform`:

| Step | Meaning |
|---|---|
| `{ "lighten": 0.2 }` | mix with white by that share |
| `{ "darken": 0.2 }` | mix with black by that share |
| `{ "alpha": 0.5 }` | multiply the opacity |
| `{ "mix": { "with": "{color.accent-1}", "amount": 0.3 } }` | mix with another colour token |

The steps are applied in order and computed in OKLCH, the same colour space as CSS `color-mix(in oklch, ...)`, so a derived
colour looks the same wherever it is drawn. A theme whose links return to themselves, or whose steps are malformed or out of
range, is reported (`FLX_TOKEN_CYCLE`, `FLX_TOKEN_TRANSFORM`) and the offending colour is left out rather than drawn wrong.

## Fonts

Choose **Fonts** in the toolbar to open the font picker. The family you pick is applied to the selected elements, as one undo
step. There are three sources, and a fourth tab for what the document already holds:

- **Bundled**: Inter (sans-serif), Source Serif 4 (serif) and JetBrains Mono (monospace), regular and bold, upright and italic,
  under the SIL Open Font License. They work offline.
- **Google**: search the catalog of 1 745 open families and press **Add**. The studio fetches the regular and bold weights and the
  upright and italic styles the family has (Latin letters) and stores them **in the document**, with the family's licence and
  copyright line, so the document keeps its fonts when it is opened elsewhere. This is the only place the studio asks Google for
  anything.
- **Upload**: a WOFF2, TrueType or OpenType file of at most 5 MB. A file that is not a font, a font collection or an old WOFF 1
  file is refused with a message. A TrueType or OpenType file names its own family, weight and style; for a WOFF2 file the family
  comes from the file name (`Fira-Bold.woff2` is *Fira*). The licence of an uploaded font is yours to hold: the studio records
  it as unknown unless told otherwise.

Text is measured with the real font: the studio records each font's metrics when it is added (or ships them for the bundled
fonts), so the size layout works out for a piece of text is the size the editor draws, to within a pixel in Chromium.

## Metadata

A document carries a title, a description, authors, a language, tags and custom key-value pairs, and the times it was created and
last modified. They are stored with the document and travel with it. The command `document.updateMeta` changes them in one
undo step and sets the modification time from the host's clock; a dialog for editing them in the studio is planned.

## Where this lives in the files

- A theme is a `theme` record; the document names its theme with `themeId`, and a screen names its override the same way.
- A font is an `asset` record whose `font` field holds the family, weight, style, source, licence and the recorded metrics; the
  bytes are the document's assets.
- Both are plain data: nothing about them needs the studio to be read again.
