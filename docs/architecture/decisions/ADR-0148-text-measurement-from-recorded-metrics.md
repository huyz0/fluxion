---
status: accepted
date: 2026-10-02
decision-makers: harness (M7.10; within FR-TXT-002, FR-SHP-006, NFR-PORT-001)
---

# ADR-0148 — Text is measured from font metrics recorded from the engine that draws it

## Context and Problem Statement

FR-TXT-002 asks that the size layout measures equals the size the editor and the player render, to
1 px, and that it is the same in every host: the browser, Node (CLI, MCP, layout workers) and the
exporters. Until M7.10 there was one measurer, a 2D canvas (`createCanvasMeasurer`), which Node
cannot have, so server rendering and layout in Node had no way to measure text (ADR-0018 item 4).
03-core-engine and 01-overview named a "fontkit-based measurer" for Node.

Two facts found while building it shape the decision:

- A canvas and the DOM do not measure alike. The DOM kerns a letter against a neighbouring space
  (`" T"` is 0.3 px narrower at 16 px) and a canvas does not, so the canvas is off by up to 1.4 px on
  a 36-character line of kerning pairs, and more where ligatures and kerning meet.
- Text drawn from a font is shaped (kerning, ligatures such as `ffi`), so a sum of advance widths is
  not its width.

## Decision Drivers

- One set of numbers for every host (FR-TXT-002), reproducible: the same on CI and a laptop.
- Exactly what the DOM draws, because the DOM is what the user sees and the player ships.
- The pure packages stay pure (non-negotiable 5): no files, canvas or clock in `core`.
- No heavy dependency in the player; none at all if it can be avoided.
- Fonts arrive in M9/M10 (bundled, embedded); the format must take them.

## Considered Options

1. **A fontkit measurer in Node, the canvas in the browser** (the plan of 03-core-engine). Two engines
   shape the text independently; they agree to a pixel or two on a good day, and the editor and the
   exporters would disagree. Needs fontkit (MIT) in Node and font files read at run time.
2. **Metrics recorded from the engine that draws, added up by one pure measurer.** A script loads each
   font in Chromium, measures in the DOM at 1000 px every character, every two-character sequence
   (kerning, two-letter ligatures) and every three-letter sequence (ligatures such as `ffi`), and
   stores the advances and what the sequences add. `core` adds them up. Browser and Node run the same
   code on the same table.
3. **Measure in the DOM everywhere** (a hidden element per measurement). Exact in the browser,
   impossible in Node, slow in a fit loop.

## Decision Outcome

Chosen option 2.

- **`FaceMetrics`** (`core/text/metrics.ts`): `family`, `weight`, `style`, `unitsPerEm` (the px size
  recorded at, 1000), `advances` per character, `defaultAdvance`, `pairs` and `triples` (what a
  sequence adds beyond its parts: a pair beyond its two advances, a triple beyond its three advances
  and its two pairs; zero ones omitted). **`createMetricsMeasurer(faces, fallback)`** picks the face
  by the first family of the CSS list (any case, quoted or not), then the style, then the nearest
  weight (the heavier on a tie), adds a line's numbers and scales to the size. A font with no face goes
  to the `fallback` measurer. Heights, ascent and descent follow the canvas measurer's formulas, so
  the two agree in every number. `readFontMetrics` reads a file defensively; a face that is not well
  formed is left out.
- **Layout the same everywhere.** Text containers of the content layer (`.fx-label`,
  `.fx-connector-label`) set `text-rendering: geometricPrecision`, and the recorder measures with it.
  Without it Chromium on Linux hints glyph advances to whole pixels (up to 9 px different from Windows
  on a 120-character line); with it the recorded sizes of the Roboto samples are identical on Windows
  and in the pinned Linux image (0.000 px), so one table serves every platform. The canvas measurer sets the same
  `textRendering` on its context, so it agrees with the DOM on Linux too.
- **Recording** is `scripts/fonts/record-metrics.mjs`, run by hand when a font changes; `--check`
  fails when the committed numbers differ from what this browser measures. It also writes the
  DOM-rendered size of a set of samples, the reference of the parity tests. Fixtures are under
  `fixtures/fonts` (Roboto 400 and 700, SIL OFL 1.1, with its licence).
- **Hosts.** The browser editor and the player use `createMetricsMeasurer(faces, canvasMeasurer)`: a
  recorded font is measured as the DOM draws it, any other as the canvas does. Node hosts (CLI, MCP,
  layout workers) use the same with a fixed-metrics fallback. Wiring each host to the bundled fonts
  comes with the font work of M9 and M10; M7.10 delivers the measurer, the format and the fixtures.
- **Producers.** The file format is the contract, not the script. A producer that reads font files
  (fontkit, harfbuzz) can write the same format for fonts a user brings (M9/M10); it would be a build
  or host tool, never part of the player.

### Consequences

- Good: one measurer and one table for every host; the player gains no dependency; `core` stays pure.
- Neutral: M7.10 delivers the measurer, the format, the recorder and the fixtures. No host calls
  `createMetricsMeasurer` yet and the theme's default font (a system stack) has no recorded face, so a
  default document is still measured by the canvas. Wiring the hosts to the bundled fonts, a producer for
  uploaded fonts and the Node fixed-metrics fallback are M9 rows 8 and 10 and M10 row 13.
- Good: the numbers are the DOM's, so a ligature or a kern against a space is in them. Measured against
  48 rendered samples (five sizes and weights, one- and multi-line, kerning, ligatures, accents) the
  recorded metrics are within 0.5 px of the DOM and the heights within 0.1 px.
- Bad: metrics are recorded per font file, in one browser. A different engine (Firefox, WebKit) lays
  text out slightly differently; the numbers are Chromium's, and the 1 px claim is measured on
  Chromium only. M9 row 8 measures it on Firefox and WebKit, or this ADR is amended to say Chromium
  only (M7 cp1 F1). Right-to-left, complex scripts and font features beyond kerning and ligatures
  (small caps, tabular figures, `font-feature-settings`) are not in the table; those fall back to the
  canvas measurer, whose error is up to 2 px.
- Bad: the table does not model `letter-spacing`; the style's `letterSpacing` must be added by the
  caller.
- Neutral: three-letter sequences cover 3-letter ligatures only; a font with longer ones needs a
  producer that records them.

### Confirmation

- `packages/core/src/text/metrics.test.ts`: the arithmetic, face choice, defensive reading;
  mutation on `core` keeps its 100 % floor.
- `packages/render/src/text-parity.test.ts` (Node) and `text-parity.browser.test.tsx` (Chromium),
  both titled "FR-TXT-002: measured size equals rendered size ±1 px": the metrics measurer within 1 px
  of the recorded and the live DOM sizes of every sample; the canvas measurer within 2 px; and the
  DOM-versus-canvas kerning difference that motivates recording from the DOM.
- `node scripts/fonts/record-metrics.mjs --check` after a browser upgrade.

### Amendment (M9.14): bundled fonts, Chromium only

The bundled fonts (`packs/fonts-core`) are recorded with `record-metrics.mjs --bundled` into `packs/fonts-core/metrics.json` (and the
module the pack exports as `FONT_METRICS`); the studio registers them (`registerFontMetrics`) once the faces have loaded, and the
page's shared measurer then measures a bundled font from them and any other from the canvas. Measured in Chromium against the DOM, the
three families in four weight/style/size combinations over six samples are within 1 px. **The 1 px claim holds on Chromium only**: the
numbers are recorded from, and checked against, Chromium; Firefox and WebKit lay text out slightly differently and are not measured
here (the browser project of the unit tests is Chromium; the e2e projects do not assert text widths). A host on another engine has the
canvas measurer's error (up to 2 px) at worst where the metrics differ. This closes the M7 cp1 F1 question the Consequences left open.

Scope of the wiring: the studio registers the metrics for a family once all of its faces have loaded (a family with a failed face stays on
the canvas), and every view of the page measures through that shared measurer, the present route included. A standalone player loads no
bundled faces, so it keeps the canvas measurer until a document carries its fonts and their metrics (M10 row 13). Text outside the
recorded alphabet in a recorded family is measured at that face's default advance, as `createMetricsMeasurer` documents; the table
covers Latin, Latin-1 and common punctuation.

## Pros and Cons of the Options

### Fontkit in Node

- Good: needs no browser run; handles any font file.
- Bad: two shaping engines; a heavy dependency in Node hosts and no answer for the exporters' shared
  numbers; reads files in a pure measurement path.

### Recorded metrics

- Good: DOM-exact, one code path, no dependency. Bad: a recording step per font, per engine.

### DOM everywhere

- Good: exact. Bad: no Node; a layout per candidate line in a fit loop.

## More Information

- ADR-0018 (shape text fitting; the measurer port), 03-core-engine §7, 01-overview §text measurement.
- The canvas measurer stays for fonts with no recorded metrics (`packages/render/src/text-measurer.ts`).
