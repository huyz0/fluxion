---
status: accepted
date: 2026-11-16
decision-makers: harness (M19.54, under Huy's 2026-11-05T11:04:52Z delegation; recommended on a decision card left open to Huy), subject to independent review
---

# ADR-0220 — The editor size gate measures the initial bundle; its lazy chunks are an advisory beside it

## Context and Problem Statement

NFR-SIZE-002 limits the editor's **initial** bundle to 600 kB gzip (`EDITOR_INITIAL_GZIP`). M12.18 made the source view
(CodeMirror, the FluxScript language and the compiler) a lazy chunk so that it is not in that bundle, and m12-complete checks
that it is not imported up front. The size-limit entry named "editor initial" has no `entry` list, and with size-limit 14's
Rolldown plugin a check without one counts every chunk the build emits, lazy ones included. At 5b92102 it read 599,886 B,
of which about 117 kB is the lazy source view and 1 kB the other lazy chunks. The entry and the chunks it imports statically
are 482,006 B. M19.43 (table cell text editing, about 870 B) could not land under the measure as it stood. ADR-0176's
baseline of 436,404 B was read the same way.

## Decision Drivers

- The gate measures what the requirement names, the bundle loaded before the editor is usable.
- `EDITOR_INITIAL_GZIP` and every other threshold stay as they are.
- Growth of the lazy chunks stays visible in every run rather than disappearing from the report.

## Considered Options

1. **Keep counting every chunk.** The hard limit then also holds lazy code, which the requirement does not. Every editor
   feature from here needs a matching cut, and making code lazy (the requirement's own remedy, M12.18) saves nothing.
2. **Raise `EDITOR_INITIAL_GZIP`.** This changes NFR-SIZE-002 itself; not taken.
3. **Measure the entry and its static imports (`entry: ['index']`), and report the same bundle with its lazy chunks as an
   advisory measure at the same target.** Chosen.

## Decision Outcome

`.size-limit.js` gives "editor initial" `entry: ['index']`. size-limit then counts the `index` chunk and every chunk it
imports statically, following the imports through, and leaves out the chunks only a dynamic `import()` reaches. A new entry,
"editor with lazy chunks", measures the same file without an `entry` list against the same `EDITOR_INITIAL_GZIP`.
check-bundle-size.mjs holds "editor initial" as a hard budget, as before, and reports "editor with lazy chunks" as an
advisory (ADR-0176's policy for the embedding targets): an overrun prints `ADVISORY` and does not fail the run. A missing,
duplicate or malformed measurement still fails closed. tests/harness/editor-budget.test.mjs pins the entry list and the
advisory entry's path, limit and gzip; bundle-policy.test.mjs has a case where the advisory alone over the target passes and
the initial measure over it fails.

### Consequences

- Good: the hard budget reads the requirement's bundle, at 482 kB today, and moving code behind a dynamic import helps it again.
- Good: the whole editor's size, lazy chunks included, is still measured and printed in every run.
- Bad: lazy chunks have no hard limit. A lazy chunk that grows past the advisory target is seen in the report, not refused;
  a later milestone can make it blocking with its own target (M32's size audit lists the lazy-chunk map).
- Neutral: m12-complete's "CodeMirror and the DSL are not in the editor initial chunk" leg keeps holding what is lazy.

## More Information

- The size-limit Rolldown plugin's `getFiles` follows `imports` from the chunks named by `entry`; with no `entry` it takes
  every output file.
- Readings at 5b92102: initial 482,006 B; with lazy chunks 599,886 B.
