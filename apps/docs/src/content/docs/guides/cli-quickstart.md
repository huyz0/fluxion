---
title: CLI quickstart
description: Validate a document and render it to a static HTML page with the fluxion command.
---

The `fluxion` command (`@fluxion/cli`) checks a document and renders it to one static HTML file.
In the repository, build it first and run the built bin:

```sh
pnpm i
pnpm run build
node packages/cli/dist/bin.js --help
```

## Validate a document

```sh
node packages/cli/dist/bin.js validate examples/r0-static.flux.json
```

A valid document exits with code 0. An invalid one exits with 1 and lists every diagnostic on
stderr: severity, code, a JSON pointer into the document and the message, then a hint in
parentheses when there is one. For `fixtures/docs/invalid-ref-missing.flux.json`:

```text
fixtures/docs/invalid-ref-missing.flux.json: 1 error
error FLX_REF_MISSING /records/DhGD9zA_E_hMrDx6/screenId: no record "NoSuchScreen0000" (existing screen ids: rX_C6DIMA8co-OdW)
```

## Render to HTML

```sh
node packages/cli/dist/bin.js render examples/r0-static.flux.json -o r0-static.html
node packages/cli/dist/bin.js render examples/r0-static.flux.json -o one.html --screen <screen id>
```

The page has no script: open it in any browser. Each visible screen is drawn at its own size with
the light theme; `--screen` keeps only the named screens.

## Machine-readable output

Add `--json` to any command to get one JSON object on stdout:

```json
{"apiVersion":1,"command":"render","ok":true,"exitCode":0,"result":{"out":"r0-static.html","screens":2}}
```

A failure has `"ok": false` and an `errors` array of diagnostics instead of `result`. The schema of
each command's reply is in `packages/cli/schemas/`. Exit codes: 0 ok, 1 the input has errors, 2
usage error, 3 internal error.

## Convert between file kinds

`convert` turns a `.flux` into a `.flux.html` (one file with the player in it) or a `.flux.json` (pretty, byte-stable JSON for diffs and
git), and either of those back into a `.flux`. With `--assets external`, a `.flux.json`'s images and fonts are written beside it in a
`<name>.assets/` folder, so a diff shows only the hash that changed:

```sh
node packages/cli/dist/bin.js convert deck.flux deck.flux.html
node packages/cli/dist/bin.js convert deck.flux deck.flux.json --assets external
node packages/cli/dist/bin.js convert deck.flux.json deck.flux
```
