---
status: accepted
date: 2026-11-17
decision-makers: harness (M20.3, under Huy's 2026-11-05T11:04:52Z delegation), subject to independent review
---

# ADR-0056 — SVG export strategy

## Context and Problem Statement

FR-EXP-004 asks for an SVG export of a screen or a selection with the option of embedded or outlined fonts. Its acceptance is
that the file opens identically in Inkscape and in a browser. FR-CLI-002 lists `render --format svg`, which is still missing after
M14: `packages/cli/src/render.ts` writes html or png.

Today `<ScreenView>` draws HTML: a `.fx-screen` `<section>` and one absolutely placed `.fx-el` `<div>` per element, each with a
small `<svg>` for outlines. Rich text is HTML that the viewing browser breaks into lines (`text-view.tsx`, `rich-text.tsx`), and
colours are `var(--fx-*)` (ADR-0015). Static HTML comes from `renderToStaticMarkup(<ScreenView mode="export">)` in
`@fluxion/render/ssr`. `@fluxion/exporters` (L5) holds only `VERSION`. 04 §2.1 lets the exporter emit `<foreignObject>`; 10 §6
forbids it so that Inkscape works.

This ADR settles:

- what SSR produces the SVG;
- where text lines and font outlines come from, in Node and in the browser;
- what `<metadata>` carries;
- how components and pack views export;
- which dependencies are added;
- how "identically" is judged.

## Decision Drivers

- FR-EXP-004: standalone SVG 1.1, with no `foreignObject`, external reference or script, that opens the same in browsers and Inkscape.
- FR-EDT-010, 04 §2.6: one renderer. Export must not become a second drawing path that drifts from present mode.
- FR-TXT-002, ADR-0148: line breaks come from the one recorded-metrics measurer, which is the same in Node and the browser.
- FR-CLI-002, FR-CLI-005, ADR-0036: `render --format svg` works in Node without the optional Chromium peer, and `--json` stays
  schema-stable.
- FR-AST-003, ADR-0051, ADR-0201: reuse the M18 HarfBuzz/WOFF2 subsetter and its worker isolation; no second subsetter.
- NFR-REL-005: the same input gives the same bytes on every OS and in both hosts.
- NFR-SIZE-001/002, tech-stack §3 rules 4–5: nothing reaches the player bundle or the editor's initial bundle (ADR-0220).
- NFR-LIC-002: every new production dependency passes `check-licenses`.

## Considered Options

1. **HTML SSR inside one `<foreignObject>`**, as 04 §2.1 first said.
2. **An SVG surface of the same `<ScreenView mode="export">`**: the same tree, order, masters, builds and style resolution. Each
   view also draws SVG 1.1 leaves, and core lays out the text before rendering.
3. **A browser walk of the rendered DOM**, in the style of dom-to-svg, which reads computed styles and `getClientRects` line boxes.
4. **A hand-written serializer in `exporters`** that walks the records directly (ADR-0015's option B).

Fonts: (a) **outline by default**, with embedding as an option; (b) **embed by default**, with outlining as an option.

## Decision Outcome

Chosen: option **2**, with fonts **outlined by default** (a) and **embedded subsets by option**.

**FR-EXP-004 is not narrowed.** The requirement offers both font modes, and its acceptance holds for the default export: an
outlined file draws the same glyphs in every browser and in Inkscape. `embed` is the option for smaller files with selectable
text. Its parity is checked across the three browsers. Inkscape must open and export it cleanly, and it looks the same there
only when the fonts are installed.

1. **SSR and ownership.**
   - `ScreenViewProps` gains `surface?: 'html' | 'svg'` (default `html`). `mode-policy.ts` gains `svgSurface`, true only for
     `export`, so `mode` is still read in one place.
   - With `svg`, `<ScreenView>` draws a root `<svg>`, and `ElementNode` draws each element through
     `ElementView.Svg?: ComponentType<ElementViewProps>`. This is the `exportSvg` that 04 §2.2 planned.
   - Shape outlines, connector paths, markers, hops, gradients and table geometry are factored into shared SVG sub-components, so
     both surfaces draw them with the same code.
   - `@fluxion/exporters` owns the serializer `exportSvg(input, options, ports)` and calls `renderToStaticMarkup` itself:
     `react-dom/server` in Node, `react-dom/server.browser` in the studio. render's main entry and the player stay free of
     `react-dom/server` (ADR-0026).
   - `exporters` is "mixed": its code has no `node:*`, DOM or clock. Hosts inject ports for the measurer, font bytes, the font job
     worker, WASM instantiation, SHA-256 and asset bytes.
   - The studio imports `exporters` lazily; the player never imports it.
2. **Three phases, so the render stays synchronous and deterministic.**
   - (a) *Layout*: every text-bearing element is laid out with the host measurer. That means text, shape and connector labels,
     table cells and regions, plus the text a pack view asks for through item 4. The studio uses
     `createMetricsMeasurer(faces, canvas)`; the CLI uses `measurerFor(document)`, the recorded metrics with a fixed fallback.
   - (b) *Fonts*: the glyph inventory gathered in (a) is outlined or subset, asynchronously.
   - (c) *Render*: SSR reads the results of (a) and (b) from a context and does no other work.

   A font with no recorded metrics is measured by the fallback and reported as `FLX_EXPORT_UNMEASURED_FONT` (a warning).
3. **Text from measured line breaks.**
   - core gains a pure `layoutStyled(blocks, base, measurer, options)`. It returns lines, each with a baseline `y`, an alignment
     offset and pieces `{ text, font, x, width }`. `wrapStyled` becomes its projection, and a test keeps the two equal.
   - A line is a `<tspan x y>` and a piece is a nested `<tspan>` with an explicit `x`, so the viewer's kerning across pieces cannot
     drift. The lines sit in `<text xml:space="preserve" text-rendering="geometricPrecision">` with literal font attributes.
   - Underline and strike become `text-decoration`; a highlight is a `<rect>` behind its piece; a link is `<a xlink:href>` through
     `safeLinkUrl`; a list marker is a `<tspan>` at the indent.
   - `textFit` uses the size `fitText` chose.
   - No `foreignObject`, ever: 04 §2.1's export clause is amended in M20.12's commit (see More Information).
4. **`ExportContext`, a public contract for pack views.**
   - `ElementView.Svg` reaches it through `useExportText(text: RichTextDoc | string, style: ResolvedStyle, box: { w, h })`. The
     hook returns the measured line layout from item 3, together with the fonts or outline paths for each piece. While doing so,
     it records the glyphs used in the export's font inventory.
   - A pack view's own text therefore gets measured lines, and its glyphs are outlined or subset like the built-ins'.
   - Phase (a) runs every `Svg` once to collect these calls. The calls are pure, so the second run in phase (c) gets the same
     answers.
   - `ElementView` is a render export today, not an SDK one, and the layer map lets sdk use only render's types. In M20.12's
     commit a new subpath `@fluxion/sdk/export` re-exports `ElementView`, `Svg`, `ExportContext` and `useExportText` at runtime,
     with `@fluxion/render` staying a regular sdk dependency (not a peer; corrected in M20.12) kept external in the subpath's build, so every pack reads the host's one context
     instance (a bundled copy would get no measured lines). The sdk main entry stays types-only. The same commit amends
     01-overview's sdk row ("render (types; runtime through the `export` subpath, ADR-0056)"), updates the API reports
     (`check-api`) and adds a changeset: a public-API contract change under this ADR, with a test that a pack built against the
     subpath measures its text through the host's context.
5. **Fonts: `fonts: 'outline' | 'embed'`, default `outline`.**
   - *Outline*: each piece becomes one `<path>` filled with the text colour. The path is built from fontkit's `font.layout(text)`
     glyph paths (`kern`, `liga`), scaled by size/unitsPerEm and placed at the piece's measured `x` and baseline.
   - The outlined text goes in its group's `<title>`, for accessibility and search.
   - fontkit gets SFNT bytes decoded by the pinned WOFF2 codec, not through fontkit's own Brotli path. fontkit is loaded with a
     dynamic `import()` when an export starts.
   - *Embed*: each face in the inventory is cut to exactly the export's codepoints by format's `runFontSubsetJob`, through the
     host's `FontJobWorker` (a studio worker or a CLI worker thread, under ADR-0051's limits).
   - Each embedded face is written once in `<defs><style>` as
     `@font-face{font-family:"fx-export-<sha256:12>";src:url(data:font/woff2;base64,…) format("woff2")}`. Text names that alias
     first, then the original family list.
   - If a subset fails, the whole verified font is embedded instead (ADR-0051's lossless fallback), reported as
     `FLX_EXPORT_FONT_WHOLE`.
   - In both modes, a face with no bytes (a system or generic family) stays as `<text>` naming the family, reported as
     `FLX_EXPORT_FONT_NOT_EMBEDDED`. Artwork fonts (ADR-0192) are outlined or embedded the same way, under their private aliases.
6. **Scope: screen or selection.**
   - A screen export draws the screen, its master beneath it, and a `viewBox` of the screen area.
   - A selection export draws the selected elements and their members, without the master. Connectors are included only when both
     ends are selected.
   - Its `viewBox` is the union of the selected elements' world bounds, widened by their stroke and effect outsets and rounded out
     to whole px.
7. **Package in `<metadata>`.**
   - The element is `<metadata><fluxion:package xmlns:fluxion="https://fluxion.dev/ns/svg/1" encoding="base64"
     media-type="application/vnd.fluxion+zip" schema="<schema version>" scope="screen|selection" screen="<id>"
     sha256="<hex of the bytes>">…</fluxion:package></metadata>`.
   - The payload is a `.flux` written by `writePortableFlux`. It holds the exported screen only, pruned to the item 6 selection
     when there is one, plus the closure of its references: master, theme, assets and used packs (`schema/references.ts`). Other
     screens never leak into the file.
   - A payload over `SVG_PACKAGE_MAX_BYTES` (2 MiB, the PNG `iTXt` bound of 10 §6) is left out, with `omitted="too-large"` and
     `FLX_EXPORT_PACKAGE_OMITTED`. `package: false` also leaves it out.
   - This is a file-format surface, so fixtures and a round-trip test (`loadFlux` of the payload) ship with M20.12.
   - The package is written now. Opening it back (08 §7 sniffing) is handed to M30 plan task 5, beside the editable PNG.
8. **Nested per-element `<svg>`.**
   - SVG 1.1 has no `transform` on `<svg>`, so each element is drawn as
     `<g data-el-id="…" transform="rotate(r cx cy) [flip about the centre]"><svg x y width height viewBox="0 0 w h" overflow="visible">…</svg></g>`.
   - Members are stored in screen coordinates, so they follow their parent as siblings, not inside its `<svg>`. A frame
     (ADR-0052) wraps its members in `<g clip-path>`, with a `<clipPath>` of its outline in screen coordinates, rotation included.
   - Connectors have no box and draw in screen coordinates. Masters draw beneath the screen, as `MasterLayer` does.
   - **Colours on the svg surface are resolved literals** (`resolveStyle` and then `substitute`; no `var()`, which Inkscape does
     not read), written as presentation attributes, not classes. `ElementViewProps`' doc rule ("colours via `var(--fx-…)`, never
     token values") is amended in M20.12's doc comment: the rule applies to the html surface, and literals apply to the svg surface.
   - Effects use only SVG 1.1 filter primitives: `feGaussianBlur`, `feOffset`, `feFlood`, `feComposite`, `feMerge`,
     `feMorphology` (a shadow's spread) and `feComponentTransfer` with `feFuncA` (an inset's alpha), never `feDropShadow`.
   - Images are `<image xlink:href="data:…">`. Sanitized SVG artwork (ADR-0186) is inlined as a nested `<svg>` with its ids
     prefixed.
   - React's `useId` ids («r1») are not XML names. The serializer renumbers them `fx<screen>-<n>`, along with every `url(#…)` that
     refers to them, as the goldens' `normalizeSvg` does.
   - The root carries `version="1.1"`, `xmlns`, `xmlns:xlink`, `width`, `height`, `viewBox`, a `<title>` (the screen name) and a
     `<desc>` (the alt text). An element's `a11y` words become the `<title>` of its `<g>`.
   - Numbers are fixed to three decimals. The screen is drawn fully built (`hidden` is none, as in `renderDocumentToHtml`).
9. **Components and pack views.**
   - A `component` element is drawn from its snapshot: `snapshotAssetId` as an `<image>` data URL. Without a snapshot it gets the
     placeholder outline and `FLX_EXPORT_NO_SNAPSHOT`.
   - A registered view without `Svg` gets the placeholder (FR-DOC-005) and `FLX_EXPORT_NO_SVG_VIEW`.
   - Diagnostics are returned with the SVG, and the export dialog and the CLI list them. Nothing is rasterized silently.
10. **Hosts and the CLI contract.**
    - `svgExporter: ExporterDef` (10 §6) runs in `['browser', 'node']`. Its Zod options are `{ fonts, package, scope }`.
    - The studio's "Export SVG" downloads `<screen>.svg` for a screen, or `<screen>-selection.svg` for a selection.
    - `fluxion render <file> -o <dir> --format svg [--fonts outline|embed] [--screen <id>…]` writes `<dir>/<screen-id>.svg` for each
      screen, without a browser. This amends ADR-0036's "svg through the browser"; ADR-0036's index row gets "amended by ADR-0056".
    - The `--json` result is png's `{ out, screens, files }` plus `diagnostics`, with an updated schema snapshot. Exit codes follow
      FR-CLI-005.
11. **Dependencies.**
    - One production dependency is added, to `@fluxion/exporters` only: `fontkit@2.0.4` (MIT), pinned exactly.
    - Its runtime tree, as the reviewer checked it in the registry:
      - `@swc/helpers` (Apache-2.0), which brings `tslib` (0BSD);
      - `brotli` and `base64-js`;
      - `clone`, `dfa` and `fast-deep-equal`;
      - `restructure` and `tiny-inflate`;
      - `unicode-properties` and `unicode-trie`;
      - `pako@0.2.x`.
    - Every package without a licence named above is MIT. Each of these licences is in `LICENSES.allow`.
    - `pako@0.2.x` declares its licence in the legacy object form. `check-licenses` must read that form as MIT and confirm the
      whole tree at install, and the commit body states the reason for the dependency.
    - `react-dom` (MIT) is a peer, as in render.
    - Nothing enters the player (`PLAYER_CORE_GZIP` is unchanged) or the editor's initial bundle. fontkit sits in a lazy chunk,
      covered by size-limit's advisory lazy report (ADR-0220).
    - No new WASM: the subsetter and the codec are ADR-0051's.
12. **Parity: how "identically" is judged.** Every comparison uses `e2e/pages/image-diff.ts`'s `diffPct` with
    `PARITY_CHANNEL_DELTA` and `PARITY_EDGE_DELTA`, and must come out at or under `PARITY_MAX_DIFF_PCT` (0.1 %). No threshold is
    added or changed.
    - *Browsers*: `e2e/export.svg-parity.spec.ts` runs on Chromium, Firefox and WebKit.
      - The fixtures are the `shapes-gallery`, `r0-static` and `masters-tables` examples, plus a text-heavy screen, a master, a
        table, a clipping frame, a rotated and flipped group, a gradient, an image and a labelled connector with markers.
      - Each fixture is exported by the CLI in both font modes and loaded as a blob URL in an `<img>` at scale 1.
      - The same engine rasterizes it with every network request refused, which also proves the file is standalone.
      - The raster is compared with that engine's present-mode screenshot, fitted 1:1 and advanced to the last build.
    - *Inkscape*: the nightly job `svg-inkscape` (`nightly.yml`, ubuntu-latest) runs the check.
      - It installs a pinned Inkscape 1.4 AppImage, checked by SHA-256 and extracted, so it needs no FUSE.
      - It exports the fixtures in both modes and runs
        `inkscape --export-type=png --export-filename=<f>.png <f>.svg` on each.
      - It fails, with no retry, on a non-zero exit, a missing or empty PNG, or an `ERROR` or `CRITICAL` line on stderr.
      - It then runs the pixel diff of every outlined (default) fixture's Inkscape PNG against the Chromium raster of the same file.
        Each fixture's `diffPct` is written to the job's JSON artifact and log, and the job fails above `PARITY_MAX_DIFF_PCT`.
      - If cairo's anti-aliasing cannot meet that bound, it is a defect to fix in M20.14, or a `blockedReason` for a human. It is
        never a new or looser threshold.
      - Embedded fixtures must open and export cleanly. They are not diffed, because Inkscape draws them in installed fonts.
    - *Evidence*: `scripts/gates/check-inkscape-evidence.mjs --record <run-id>` writes `.harness/reviews/inkscape-evidence.json`.
      It refuses a run if any of these hold:
      - its `svg-inkscape` job did not conclude success;
      - it ran on a commit on this branch before M20.14's;
      - its `nightly.yml` at that commit lacks the pinned hash, the failure rules or the diff step;
      - its artifact or log does not report a `diffPct` at or under `PARITY_MAX_DIFF_PCT` for every outlined fixture.

      Dropping the diff step therefore turns the leg red. m20-complete reads the record, as it reads `check-png-evidence.mjs`'s
      (M19.52).

### Consequences

- Good: export is the present-mode tree with SVG leaves. Masters, builds, order, style resolution and shared geometry cannot drift,
  and a pack opts in with one optional `Svg` component plus `useExportText`.
- Good: Node and the browser produce identical bytes from the same measurer and font inputs, and the CLI needs no browser.
- Good: the default file looks the same in every browser and in Inkscape (FR-EXP-004). `embed` keeps text selectable and small
  through the existing bounded subsetter.
- Bad: the default output is heavier than an embedded subset, its text is not selectable (its `<title>` is still read and
  searched), and every default export loads fontkit (lazily, never in the player).
- Bad: every built-in view gains a second leaf, text in particular. Pack views without `Svg` export as placeholders.
- Bad: core layout must match the browser's line breaking. A font with no recorded metrics fails parity, and the warning names it.
- Bad: fontkit's shaping inside a piece may differ slightly from the browser's.
- Bad: `<metadata>` can reach 2 MiB; `package: false` opts out.

### Confirmation

- `packages/exporters/src/svg.test.ts` (FR-EXP-004), on every fixture:
  - the file is well-formed XML with root `version="1.1"`;
  - it uses only elements and attributes from `svg11.ts`'s SVG 1.1 table;
  - it contains no `foreignObject`, `script`, `on*`, `var(`, `transform` on `<svg>`, `feDropShadow`, or a reference outside `<a>`
    that is neither `data:` nor a fragment;
  - ids are XML names and every `url(#)` resolves;
  - text lines equal `layoutStyled`'s, including a test pack view's text drawn through `useExportText`, whose glyphs reach the
    subset and the outline;
  - the selection `viewBox` and the inclusion of the master and connectors follow item 6;
  - the `<metadata>` payload reopens with `loadFlux`, and its `sha256` matches;
  - the bytes are deterministic (a golden), and the browser build's bytes are the same (`svg.browser.test.ts`).
- core `layout-styled.test.ts` (a property test, FR-TXT-002): the `wrapStyled` projection equals `layoutStyled`.
- `e2e/export.svg-parity.spec.ts`: three engines, both font modes, at or under `PARITY_MAX_DIFF_PCT`, no network.
- `e2e/export.svg.spec.ts` (FR-EXP-004): the studio downloads one SVG for a screen and one for a selection, in three engines, with
  axe. The download's bytes equal the CLI's for the same fixture.
- `packages/cli/src/e2e/render-svg.test.ts` (FR-CLI-002): one SVG per screen, the default and `--fonts embed`, the `--json` schema
  snapshot, and the exit codes.
- `scripts/gates/check-inkscape-evidence.mjs` with its harness test, which covers refusing a run without the diff step or without
  a result for every fixture. m20-complete's Inkscape leg reads the record.
- `check-licenses`; `check-api` for `ElementView.Svg`, `ExportContext`/`useExportText` and their SDK re-exports,
  `ScreenViewProps.surface` and the exporters API; `check-layering` (cli → exporters, and no `node:*` in exporters' code); and
  `check-mode-policy`.

## Pros and Cons of the Options

1. **foreignObject.**
   - Good: no new drawing code, and the viewer breaks the text.
   - Bad: Inkscape, librsvg and most editors do not render it, so it fails FR-EXP-004's own acceptance. Line breaks depend on the
     viewer, and WebKit has transform and clip bugs (04 §2.1).
2. **SVG surface (chosen).**
   - Good: one tree and one measurer, deterministic, and it runs in Node.
   - Bad: a second leaf per view, and core layout must carry piece positions.
3. **DOM walk.**
   - Good: exact for the engine that walks.
   - Bad: the CLI would need Chromium, against ADR-0036's no-browser `svg` path and FR-CLI-002 in Node. The output depends on the
     engine, so it is not deterministic under NFR-REL-005, and Node tests cannot run it.
4. **Hand-written serializer.**
   - Good: no React in the exporter.
   - Bad: a second renderer for every kind, master and build, which drifts from present mode (ADR-0015 rejected the same).

Fonts:

- (a) **Outline by default (chosen).**
  - Good: glyphs are geometry, so browsers, Inkscape and any other SVG tool draw the same shapes. The default export meets
    FR-EXP-004's acceptance without installed fonts.
  - Bad: the file is heavier for text-heavy screens, the text is not selectable, and every default export loads fontkit.
  - Accepted because FR-EXP-004 promises identical output, and the cost falls only on export: the lazy chunk, file size, and text
    that is still searchable through `<title>`.
- (b) **Embed by default.**
  - Good: small files with selectable text, using only the existing subsetter.
  - Bad: Inkscape ignores `@font-face` data URLs, so the default file would not open identically there. Kept as the option.
- Outliner alternatives:
  - **HarfBuzz's shaping build**: exact GSUB/GPOS and CSP-safe WASM, but a new reproducible build under ADR-0051. Deferred; fontkit
    sits behind one adapter, so it can be swapped.
  - **fontkitten**: lighter, but no WOFF2 support and unverified shaping. Not taken.

## More Information

- Doc updates and the commits they ship in:
  - M20.12: 04 §2.1 (drop the export `foreignObject` clause), 04 §2.2 (`surface`, `ElementView.Svg`, `ExportContext`), and the
    `ElementViewProps` colour doc comment.
  - M20.15: 01 §2, the layer map entry for cli → exporters.
  - M20.24: 10 §6 (the SVG row: outline default, the metadata element).
  - This commit: the index row for this ADR, and ADR-0036's row, which gets "amended by ADR-0056".
- Uncertain, to be checked before the dependent rows close:
  - Whether fontkit 2.0.4 loads under the studio CSP (`script-src 'self' 'wasm-unsafe-eval'`, with `Function` blocked); checked in
    M20.13. The default mode depends on it. If it fails, that is a defect in M20.13, or a `blockedReason`, not a change of default.
  - Whether Inkscape 1.4 meets `PARITY_MAX_DIFF_PCT` on outlined fixtures given cairo's anti-aliasing (M20.14, item 12).
  - The exact Inkscape AppImage version and hash (M20.14).
- Amended in M20.12's commit:
  - Item 1: there is no `surface` prop on `ScreenViewProps`. The svg surface is `ScreenSvgView` in a separate subpath,
    `@fluxion/render/svg`, which maps each html view component to its `Svg` leaf (`BUILTIN_SVG_LEAVES`) and reads
    `modePolicy(mode).svgSurface`. render's main entry and the player bundle carry none of it.
  - Item 7: `exportSvg` writes the package through a `writePackage` port. Its default is format's `writeFlux` with no asset
    bytes; hosts with asset bytes pass `writePortableFlux` (M20.15).
  - Item 4 (`ExportContext`, `useExportText`, the `@fluxion/sdk/export` subpath kept external from render), the table, region,
    frame-clip, image, artwork, component-snapshot and effects leaves, rich-text marks (decorations, highlights, links, list
    markers), the selection scope and its `viewBox`, and the browser byte-parity case move to M20.40, which M20.13 depends on.
    M20.40 draws the frame clip, image, image-fill, component-snapshot, effects and artwork leaves and splits the rest: tables,
    regions and rich-text marks (M20.41), item 4's contract (M20.42), the selection scope and byte parity (M20.43). The svg surface
    reads images only as `data:` URLs from the exporter's `assets` port; any other URL is reported (`FLX_EXPORT_ASSET_MISSING`)
    and not written.
    Item 4's "peer" wording is corrected here: render stays a regular sdk dependency, kept external in the subpath's build.
- Related: ADR-0015, ADR-0026, ADR-0036, ADR-0051, ADR-0052, ADR-0054, ADR-0148, ADR-0186, ADR-0192, ADR-0201, ADR-0220.
