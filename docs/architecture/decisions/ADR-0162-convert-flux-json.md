---
status: accepted
date: 2026-10-07
decision-makers: harness (M12.31; an additive change to the `convert` command's contract of ADR-0155, within FR-FIL-005 and FR-CLI-001)
---

# ADR-0162 — `fluxion convert` writes and reads `.flux.json`, with `--assets inline|external`

## Context and Problem Statement

FR-FIL-005 asks for a pretty, deterministic `.flux.json` for diffs and git. Architecture 08 §4 says `--assets=external` writes assets as
`<name>.assets/<sha256>.<ext>` beside the JSON. M12.15 built the writer and reader in `@fluxion/format`, but no command reaches them. ADR-0155
gave `fluxion convert` exactly one pair, `.flux` and `.flux.html`, and its `--json` reply is a contract (contracts.md §1, §6). How does the
CLI produce and read `.flux.json`?

## Considered Options

1. **A new command (`fluxion export-json`).** Its own reply and its own help, but a second command for what is a conversion between two
   containers of the same document.
2. **Extend `convert`: a `.flux.json` may be either side, paired with a `.flux`.** One verb for every container change. Its reply's
   `direction` gains two values, and the command gains an option. The pairs `.flux.html` and `.flux.json` stay out: they go through a
   `.flux`.

## Decision Outcome

Option 2.

- **Pairs.** `.flux` → `.flux.json` and `.flux.json` → `.flux`, beside ADR-0155's two. Names are matched case-insensitively, and
  `.flux.json` is checked before `.flux`. Any other pair is still a usage error (exit 2), and nothing is written.
- **`.flux` → `.flux.json`.** The archive is opened by `loadFlux` (a corrupt or unsafe archive exits 1). Its document, FluxScript source and
  assets are written by `writeFluxJson`.
- **`.flux.json` → `.flux`.** `readFluxJson` reads it, external assets from the JSON's folder. Only `<name>.assets/<hash>.<ext>` is read,
  and each asset's bytes must hash to their key. `writeFlux` then writes the archive. Converting `.flux.json` → `.flux` → `.flux.json` gives
  the same JSON bytes. Converting `.flux` → `.flux.json` → `.flux` gives the same document, not the same archive bytes: the manifest's app
  and times come from the writer.
- **`--assets inline|external`** (default `inline`) applies only when the output is a `.flux.json`. Any other value, or the option on
  another output, is a usage error. With `external`, the files go to `<name>.assets/` next to the output, where `<name>` is the output's
  file name without `.flux.json`. A name the reader would refuse (one starting with `.`, or containing `/`, `\` or `:`) is refused by the
  writer too.
- **Reply.** `direction` gains `"to-json"` and `"from-json"`. `bytes` is the size of the file written (the JSON, without the asset
  files). The shape is otherwise unchanged, so `apiVersion` stays 1: an added enum value in a reply is additive under contracts.md rule 3,
  as ADR-0155's new command was. `schemas/convert.output.json` is regenerated.

## Consequences

- Good: git-friendly documents need one command, and the same verb converts every container.
- Neutral: a reader that switched over `direction` without a default sees two values it did not know. contracts.md rule 3 already asks
  consumers to tolerate added values.
- Bad: `.flux.html` ↔ `.flux.json` takes two commands.

## Confirmation

The CLI e2e test converts `.flux` → `.flux.json` → `.flux` to the same document, with inline and with external assets, and refuses a bad
`--assets` value and a bad pair. The schema snapshot test covers the new `direction` values.

## More Information

ADR-0155 (convert), architecture/08 §4, contracts.md, M12.15 (`writeFluxJson`, `readFluxJson`).
