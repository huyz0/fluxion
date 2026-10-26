# @fluxion/cli

The fluxion command: validate, compile, decompile, patch, lint, layout, migrate, convert, render, catalog (pack and site build arrive in later milestones).

| Layer | Pure | Status |
|---|---|---|
| L5 | no | M14: the authoring loop (compile, patch, lint, layout --score, decompile, catalog), PNG render, Mermaid export |

```bash
fluxion validate deck.flux.json          # diagnostics with JSON pointers; exit 1 on errors
fluxion render deck.flux.json -o deck.html [--screen <id>]
fluxion validate deck.flux.json --json   # one reply object on stdout
fluxion compile deck.flux.yaml -o deck.flux.json
fluxion patch deck.flux.json change.patch.json -o deck.flux.json   # all or nothing; exit 1 when rejected
fluxion lint deck.flux.json --min-score 90                          # exit 1 below the score
fluxion layout deck.flux.json --score                               # overlaps, crossings, bends, displacement
fluxion decompile deck.flux.json -o deck.flux.yaml [--format mermaid --screen <id>]
fluxion render deck.flux.json --format png -o shots/                # needs a Chromium (else exit 2)
fluxion catalog --format llm                                        # what the host can draw
```

Exit codes: 0 ok, 1 the input has errors, 2 usage error, 3 internal error. With `--json` every
command prints one reply, `{ apiVersion, command, ok, exitCode }` plus `result` or `errors[]`; the
reply schemas are generated to `schemas/<command>.output.json` (ADR-0147, docs/standards/contracts.md §6).
Quickstart: `apps/docs` → Guides → CLI quickstart.

A scripted session is in `examples/cli/`.

### Owned SVG paint witness

`@fluxion/cli/svg-witness` exposes `createNodeSvgPaintWitness({ theme, fonts, browser?, signal? })`.
It needs the optional Playwright peer and the explicitly selected installed engine (Chromium by
default). It loads its shipped browser artifact relative to the installed package, launches one
loopback-only browser server and blocks context network requests before creating a page.

The returned `Result` contains `{ witness, observe, dispose }`. Use `witness` with the SVG importer;
use `observe` when the caller needs typed failures such as `invalid-input`, `unsupported`,
`peer-missing`, `deadline`, `cancelled`, `transport` or `cleanup`. Always await `dispose()` in
`finally`: a successful close requires observed exit of the owned browser process. A cleanup
failure is never reported as successful shutdown. Check the disposal Result before committing
imported output; an earlier paint receipt does not establish that later cleanup succeeded.

The context and exact font profile match `@fluxion/render/svg-witness`. Node transport checks
bounded plain data, at most eight faces/8 MiB of font bytes and a conservative 32 MiB encoded
payload ceiling before transport. One session admits at most 128 requests, one active at a time,
with ten-second observation deadlines. Its 120-second lifetime reserves the final two seconds
for cleanup, including a one-second graceful-close window before killing only its owned server.
No alternate-browser fallback, remote renderer, output-file write or pack-import command is added.
