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

A valid document exits with code 0. An invalid one exits with 1 and lists every diagnostic with a
JSON pointer into the document, for example
`error FLX_REF_MISSING /records/DhGD9zA_E_hMrDx6/screenId: no record "NoSuchScreen0000"`.

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
