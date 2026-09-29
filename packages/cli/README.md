# @fluxion/cli

The fluxion command: validate, compile, render, lint, layout, convert, catalog, pack, site build.

| Layer | Pure | Status |
|---|---|---|
| L5 | no | M4: `fluxion validate`, `fluxion render` (static HTML), `--json` replies |

```bash
fluxion validate deck.flux.json          # diagnostics with JSON pointers; exit 1 on errors
fluxion render deck.flux.json -o deck.html [--screen <id>]
fluxion validate deck.flux.json --json   # one reply object on stdout
```

Exit codes: 0 ok, 1 the input has errors, 2 usage error, 3 internal error. With `--json` every
command prints one reply, `{ apiVersion, command, ok, exitCode }` plus `result` or `errors[]`; the
reply schemas are generated to `schemas/<command>.output.json` (ADR-0147, docs/standards/contracts.md §6).
Quickstart: `apps/docs` → Guides → CLI quickstart.
