# Examples

Documents that show what Fluxion renders today. Each one validates with no errors and renders
with the CLI (`pnpm run build` first):

```bash
node packages/cli/dist/bin.js validate examples/r0-static.flux.json
node packages/cli/dist/bin.js render examples/r0-static.flux.json -o r0-static.html
node packages/cli/dist/bin.js render examples/shapes-gallery.flux.json -o shapes-gallery.html
```

| File | Shows |
|---|---|
| `r0-static.flux.json` | The R0 demo (M4): two screens of rectangles joined by straight connectors, styled with theme tokens (`{color.primary}`, `{color.accent-1}`, `{stroke.thin}`, …). CI renders it on every run and uploads `r0-static.html` as the `r0-static-demo` artifact. |
| `shapes-gallery.flux.json` | The M5 gallery: the 21 shapes of the basic pack (`basic:rect` … `basic:image-frame`), connectors on the four routes (`straight`, `curved`, `orthogonal` with a corner radius, `polyline` through a waypoint) bound by floating and named anchors, every built-in and basic-pack marker (arrow, triangle, diamond, circle, bar, open arrow, crow's feet) and labels. CI renders it and uploads `shapes-gallery.html` as the `shapes-gallery-demo` artifact. The same document is the shared fixture `fixtures/docs/shapes-gallery.flux.json`. |
| `perf-500.flux.json` | The drag benchmark (M6.23, NFR-PERF-001): 500 elements on one screen, 460 basic-pack shapes in a grid (a third labelled) and 40 connectors. The E2E `perf.drag-500` drags one of them and measures frames. The same document is the shared fixture `fixtures/docs/perf-500.flux.json`. |
| `rich-text.flux.json` | The rich-text fixture (M7.14, FR-TXT-001): every mark (bold, italic, underline, strike, code, colour, highlight, size, link), heading levels, alignment, line and paragraph spacing, a field, nested bullet and numbered lists, in shape labels and in `text` elements. The E2E `parity.edit-vs-present` draws it in edit and present and compares the pixels. The same document is the shared fixture `fixtures/docs/rich-text.flux.json`. |
| `arrange-demo.flux.json` | Screens & arranging (M8): a group of two shapes, two sections (Intro and Reference), speaker notes on two screens, a hidden screen and a connector. The guide "Screens & arranging" walks through it. |

The files are canonical `.flux.json` (the form `fluxion` writes); edit them with any editor and
check them with `fluxion validate`.
