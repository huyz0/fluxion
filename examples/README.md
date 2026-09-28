# Examples

Documents that show what Fluxion renders today. Each one validates with no errors and renders
with the CLI (`pnpm run build` first):

```bash
node packages/cli/dist/bin.js validate examples/r0-static.flux.json
node packages/cli/dist/bin.js render examples/r0-static.flux.json -o r0-static.html
```

| File | Shows |
|---|---|
| `r0-static.flux.json` | The R0 demo (M4): two screens of rectangles joined by straight connectors, styled with theme tokens (`{color.primary}`, `{color.accent-1}`, `{stroke.thin}`, …). CI renders it on every run and uploads `r0-static.html` as the `r0-static-demo` artifact. |

The files are canonical `.flux.json` (the form `fluxion` writes); edit them with any editor and
check them with `fluxion validate`.
