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

The files are canonical `.flux.json` (the form `fluxion` writes); edit them with any editor and
check them with `fluxion validate`.
