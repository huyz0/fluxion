---
status: accepted
date: 2026-10-05
decision-makers: the human (answers to the three open M10 decisions, 2026-10-05), recorded by harness (M10.45; amends NFR-SIZE-003, no contract or dependency change)
---

# ADR-0157 — The `.flux.html` budget is gzip; the manifest's shape-def list and `sanitizeHtml` wait for their consumers

## Context and Problem Statement

M10 closed with three decisions only the human could make, and M11 waited on one of them (M11.25's exit checklist and `m11-complete`):

1. **M10.45.** NFR-SIZE-003 says a typical 20-screen document is `.flux.html ≤ 450 kB (incl. player)`. The page for the 20-screen fixture is about 750 kB raw (the inline player alone is
   728 kB) and about 241 kB gzip. `thresholds.mjs` lists the budget under "bytes gzip", but the requirement, `performance.md` and architecture 08 did not say which.
2. **M10.57.** The manifest could list the shape definitions a document uses (a file-format contract: an ADR, fixtures, loader validation, `specs/format`). Nothing would read it.
3. **M10.27.** A `sanitizeHtml` for pasted HTML. It does not exist (deferred out of M10.9, because the editor's paste reads text, SVG and images only), so nothing would call it.

## Decision Outcome

1. **The `.flux.html` budget is measured gzip: 450 kB** (`DOC20_FLUX_HTML_BYTES`, unchanged). It is what a person downloads or sends, and it is the basis of every other size budget
   (`PLAYER_CORE_GZIP`, `EDITOR_INITIAL_GZIP`). NFR-SIZE-003, `performance.md` and architecture 08 now say "gzip". The fixture passes at about 241 kB. The `.flux` budget (150 kB) is
   unchanged: a `.flux` is already compressed. No threshold moved, so no gate is weakened. The test is `e2e/file.size.spec.ts` (the page is made from the built player, as the specs do).
2. **M10.57 waits until a consumer exists** (the player loading shape definitions on demand). No contract changes without a reader. The row is descoped by this ADR.
3. **M10.27 waits until HTML paste is planned.** The row is descoped by this ADR; `sanitizeHtml` is built with its corpus when the paste feature lands. There is nothing to keep or remove today.

## Consequences

- Good: the R1 exit can name NFR-SIZE-003 decided and passing (R1-exit.md).
- Good: no contract or dependency changes.
- Neutral: a raw-size reading of NFR-SIZE-003 would need the player cut to a third of its size; the research (`docs/research/07-player-size.md`) shows that is not reachable soon.

## Confirmation

`e2e/file.size.spec.ts`: "NFR-SIZE-003: the 20-screen document in .flux.html is within DOC20_FLUX_HTML_BYTES (gzip)".
