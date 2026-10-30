---
status: accepted
date: 2026-10-27
decision-makers: harness (M18.40; the metadata and CLI contract ADR-0051 left to M18.40, subject to independent review)
---

# ADR-0201 — Subset fonts record their source in `font.subset`; `fluxion convert --subset-fonts` reports each font

## Context and Problem Statement

ADR-0051 decided how fonts are subset on save: off by default, a validated candidate copy, whole-font fallback with a reason,
one disposable worker per font with a 30 s watchdog, and original-source identity kept apart from the subset's integrity hash.
It left two contracts to M18.40: how a saved file records that a font is a subset (specs/format/flux-1.0.md §4 said fonts are
stored whole), and how the CLI asks for and reports it (`convert --json` is a contract, contracts.md §1).

## Considered Options

1. **A new manifest section listing subsets.** Keeps asset records untouched, but splits one font's identity across two places
   and needs a new manifest field every reader must learn.
2. **A `font.subset` object on the font's asset record.** The record already carries the face, licence and copyright under
   `font`; asset records are loose objects (schema `looseObject`), so readers keep fields they do not know.
3. **For the CLI, a new `subset-fonts` command.** One more verb for what is a rewrite of the same container.
4. **For the CLI, a `--subset-fonts` option on `convert`,** allowing `.flux` → `.flux` only with the option.

## Decision Outcome

Options 2 and 4.

- **Record.** A subset font's asset record has `hash`, `size`, `mime: font/woff2` and a `.woff2` `name` of the subset bytes,
  and keeps its `font` fields. `font.subset` is `{ source, sourceSize, policy, fingerprint, unicodes }`: the SHA-256 and size of
  the whole font it was cut from (kept through later re-subsets), the adapter policy (`FONT_SUBSET_POLICY`), the layout
  fingerprint, and the inventory as a CSS `unicode-range`. No schema version changes: the field is additive, and whole-font
  files are unchanged. The spec's §4 says so. A save whose text needs characters outside `unicodes` reports them (the studio
  names the font and the characters); nothing fetches the original.
- **Location of the engines.** The pinned modules move from `packages/editor/assets/font-engine/` to
  `packages/format/assets/font-engine/`, shipped in `@fluxion/format`'s package files, and the host-agnostic save code
  (inventory, engine instantiation through an injected `WebAssembly` port, plan, candidate, job runner) moves to `format`, so the
  CLI uses it without importing the editor (ADR-0051, architecture 01). Hosts own workers and timers.
- **CLI.** `fluxion convert <in> <out> --subset-fonts` applies to the `.flux` read into a `.flux.html` or a `.flux`, or the `.flux`
  written from a `.flux.html` or `.flux.json`. `.flux` → `.flux` is a pair only with the option; with a `.flux.json` output the
  option is a usage error (exit 2). Each font job runs in a fresh worker thread. The written candidate must reopen with every
  subset record pointing at WOFF2 bytes of its hash; otherwise the input's own bytes are written and every font is reported
  kept. A file that opens read-only or in part is not rewritten (exit 1).
- **Reply.** `result.fonts` (present only with the option) lists `{ asset, name, before, after, status: "subset" }` or
  `{ …, status: "kept", reason, message }`, with `reason` one of ADR-0051's typed reasons. `apiVersion` stays 1: an optional
  added field is additive under contracts.md rule 3. `schemas/convert.output.json` is regenerated.

## Consequences

- Good: one record holds a font's whole identity; older readers open and re-save subset files unchanged.
- Good: the studio and the CLI run the same code over the same pinned bytes.
- Bad: `@fluxion/format`'s package grows by the two engine modules (about 1.4 MB), though the player never loads them.
- Neutral: a strict reply consumer sees a new optional field only when it passes the new option.

## Confirmation

`fixtures/fonts/fira-sans-subset.flux` (written by the CLI) opens and re-saves with `font.subset` and its bytes intact
(`packages/editor/src/font-subset-compat.test.ts`). `packages/cli/src/e2e/cli.subset-fonts.test.ts` runs the built bin on
`.flux` and `.flux.html` outputs, an unverified source and the usage errors; `packages/cli/src/font-subset.test.ts` covers
worker failures. The studio's browser tests and `e2e/library.font-subset.spec.ts` cover the save option.

## More Information

ADR-0051, ADR-0155, ADR-0162, contracts.md, specs/format/flux-1.0.md §4.
