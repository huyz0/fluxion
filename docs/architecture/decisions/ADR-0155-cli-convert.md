---
status: accepted
date: 2026-10-04
decision-makers: harness (M10.30; within ADR-0147, ADR-0154, FR-FIL-003, FR-CLI-001 and contracts.md §1 and §6; no external dependency)
---

# ADR-0155 — `fluxion convert`: a `.flux` and a `.flux.html` are the same document

## Context and Problem Statement

FR-FIL-003 asks for a `.flux.html` to import back to the same document as the `.flux` it was made from. The studio opens both
(M10.17), but a build, a script or an AI agent has no way to turn one into the other without the studio. The command line is the
one tool every host shares (ADR-0147), and its `--json` reply is a contract (contracts.md §1, §6): a new command needs its reply
shape decided, with fixtures, before anyone depends on it.

## Decision Drivers

- The round trip is lossless: `.flux` → `.flux.html` → `.flux` gives the same bytes (FR-FIL-003), not just an equal document.
- One writer: the CLI embeds the same player script the studio does (`@fluxion/player-inline`, ADR-0154); no second bundle.
- Nothing in the input is trusted: the archive is found by scanning text and verified by its recorded hash; nothing executes (NFR-SEC-002).
- No new diagnostic code and no new exit code (contracts.md rule 14): a failure to read, parse or write is the existing `FLX_CLI_IO` (1);
  a command line that names no direction is `FLX_CLI_USAGE` (2).

## Considered Options

1. **Two commands**, `fluxion html a.flux` and `fluxion unpack a.flux.html`. Two names for one idea, and a third (`pack`) is already planned.
2. **A direction flag**, `convert --to html`. Redundant: the file names already say it.
3. **`convert <input> <output>`**, the direction taken from the two names: `.flux` → `.flux.html` embeds, `.flux.html` → `.flux` extracts.

## Decision Outcome

Option 3.

- **Command.** `fluxion convert <input> <output>`. The input and output must be one `.flux` and one `.flux.html` (in either order); the names
  are matched case-insensitively. Any other pair, one name or three are usage errors (exit 2) and nothing is written.
- **`.flux` → `.flux.html`.** The archive is read, checked by `loadFlux` (so a corrupt or unsafe archive is refused, exit 1), and embedded unchanged
  with the player script and the document's title (the file's name when it has none). The archive's bytes are not rewritten.
- **`.flux.html` → `.flux`.** `readFluxHtml` finds the data block by scanning text, verifies its hash and returns the archive's bytes, which are
  written unchanged. So `.flux` → `.flux.html` → `.flux` is byte-identical.
- **The player script** is `player.inline.js` beside the `@fluxion/player-inline` package's entry; a package without it (not built) is an internal
  error (exit 3), not a file without a player.
- **Reply** (`schemas/convert.output.json`, generated from the Zod schema like the others): `result` is
  `{ "from": "<input>", "to": "<output>", "direction": "to-html" | "to-flux", "bytes": <size written> }`, or the help/version results. A
  failure is `errors[]` with the existing codes. `apiVersion` stays 1: a new command is additive (contracts.md rule 3).
- **Dependencies.** `@fluxion/cli` gains `@fluxion/format` and `@fluxion/player-inline` (workspace links only; the overview map lists both).

## Consequences

- Good: the round trip is a test of bytes, in the built bin's e2e, not of document equality.
- Good: an agent can produce a shareable page from a `.flux` with one command.
- Neutral: `convert` does not re-render or migrate anything; a `.flux` of a newer major version is embedded as it is, and opens read-only where it is opened.
- Bad: the CLI now depends on the player's build output at run time; the build order (player-inline before cli) is already the workspace order.
