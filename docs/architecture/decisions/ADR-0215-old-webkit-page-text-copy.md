---
status: accepted
date: 2026-11-04
decision-makers: packs stream (M18.242) under Huy's delegation of 2026-11-04 ("you decide and carry on"), subject to independent review
---

# ADR-0215 — On the previous Playwright's WebKit, a keyboard copy of page text is the engine's limit

## Context and Problem Statement

A keyboard copy with nothing selected on the canvas and text selected on the page belongs to the
browser: the editor does not route the chord through its catcher (M18.132, use-system-clipboard.ts),
so the browser copies that text as on any page. `clipboard.copy-paste.spec.ts:58` checks this: the
copy event fires from the selected element, and the editor neither prevents it nor moves the
selection.

On the previous Playwright's WebKit (26.5, Playwright 1.62.1), the engine raises no copy event for
a keyboard chord unless the focus is in an editable field. The clipboard-events-probe prints it at
nightly 41806720128 (previous-playwright (webkit), job 126495452719): "text selected: copy -> []",
and likewise for no selection, while "editable field focused: copy -> [copy]". In the same job,
:58 is the only failing spec of 321, with no copy event recorded (expected one from `OUTPUT`,
received none). Every other clipboard spec passes, `clipboard.cross-document` among them, after
ADR-0213. The pinned WebKit passes :58 in `ci`.

## Decision Drivers

FR-EDT-007 (copy and paste), NFR-PORT-001 (the supported engines), and the rule that a page text
copy is the browser's (the editor puts nothing of its own on the clipboard for it). No retry,
quarantine or removed assertion.

## Considered Options

1. **Record it as the engine's limit.** The spec stays as it is and keeps failing on that leg.
   The roadmap's Deferred row names it as the one expected failure there. Chosen.
2. **Route a page text copy through the catcher too**, with the selected text in the text area,
   so that the engine copies it natively. On every engine the copy would then come from the
   editor's text area instead of the page, and what other applications receive would depend on
   how the text area serialises the selection (no rich text, collapsed white space). That changes
   a browser behaviour that works on every current engine to serve one older release. Rejected.
3. **Write the text with the async clipboard on a chord with no event.** On that engine
   The probe measured `writeText` only after a click ("write=ok"); a write from a keydown with no
   click was not probed. The editor would be putting its own write on a copy that belongs to the
   browser, and the M11.59 fallback already decides what a chord with no event does on the canvas.
   Rejected.

## Decision Outcome

Option 1. On WebKit 26.5 a keyboard copy of text selected outside an editable field copies
nothing, and the editor does not work around it. `clipboard.copy-paste.spec.ts:58` is the
previous-playwright (webkit) leg's expected failure, named in the roadmap's Deferred row with this
ADR. The rest of the suite must pass on that leg.

### Consequences

- Good: page text copy stays the browser's own on every engine; nothing of the editor's is put on
  the clipboard for it.
- Bad: on that one older engine a keyboard copy of page text (a label, the zoom value) does nothing.
- The nightly's previous-playwright (webkit) job stays red on that spec until the release moves
  past WebKit 26.5. A new failure there is not covered by this ADR.
