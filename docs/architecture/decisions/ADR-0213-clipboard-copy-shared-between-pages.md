---
status: accepted
date: 2026-11-03
decision-makers: packs stream (M18.242), subject to independent review
---

# ADR-0213 — The editor's newest copy is shared between its pages of one origin, for an engine that keeps only text/plain

## Context and Problem Statement

A keyboard copy puts Fluxion's payload on the system clipboard three ways (ADR-0020): the custom
type `application/x-fluxion+json`, an HTML carrier with the payload in a `<template>`, and the
elements' text as text/plain. A paste reads the custom type, then the template.

On the previous Playwright's WebKit (26.5) the copy and paste events fire on the editor's catcher
(M18.132), but the engine keeps only text/plain: at the paste the custom type and the HTML are
empty, in the same page and in a second one (clipboard-events-probe, nightly 41612451867). The
async read is refused. So no keyboard paste places Fluxion's elements there, in one document or
across documents (M18.242: copy-paste :8 and :41, cross-document :33 and :72, live-container :52).

## Decision Drivers

FR-EDT-007 (copy and paste within and across documents), NFR-PORT-001 (the supported engines),
ADR-0020 (what a paste trusts: a validated payload only), nothing written to storage that outlives
the pages, no change to the clipboard format or to what other applications receive.

## Considered Options

1. **Share the newest copy between the editor's open pages on a BroadcastChannel.** Each page keeps
   the newest copy made in any page of its origin (the payload JSON, the text/plain it put on the
   clipboard, and when). A copy is posted to the other pages; a page that opens asks the open ones
   for theirs. A paste that carries no payload of Fluxion's, no HTML, no file, and exactly the text
   the newest copy put on text/plain is that copy: it is parsed and validated like any pasted payload
   and pasted. Chosen.
2. **Keep the payload in localStorage.** Works for a page opened after the copy without asking,
   but writes up to a payload's size (32 Mi characters) to storage that outlives the session and
   every page of the origin can read later; rejected.
3. **Encode the payload into text/plain.** Every other application would receive JSON instead of
   the elements' text; rejected.
4. **Descope the keyboard paste on that engine** (ADR plus a roadmap Deferred row). Leaves
   in-document copy and paste broken on a supported engine; rejected while option 1 works.

## Decision Outcome

- `clipboard-share.ts` (editor, DOM layer): `clipboardShare(channel, now)` keeps the newest copy
  (`{ json, text, at }`). `copied(json, text)` always makes the page's own copy the newest (another
  page's clock is not trusted to outrank it) and posts it. A copy from another page replaces the
  newest only when its `at` is not older. Only the page that made its newest copy answers an
  `ask`, so one page sends it. What arrives is ignored unless it has that shape and fits
  MAX_PAYLOAD_CHARS; a closed channel does not break a copy. Without BroadcastChannel only the
  page's own copies are known.
- The hook opens the channel while mounted and closes it on unmount, so a remount (React
  StrictMode) opens a new one.
- `useSystemClipboard` records every copy and cut it puts on the clipboard (the keyboard event and
  the menu commands). A paste event uses the shared copy only when `readFromEvent` finds no
  payload, the clipboard holds no file and no HTML (the engine drops the HTML with the custom
  type), and its text/plain equals the copy's text (line ends aside). The copy still goes through `parsePayload` before it is adopted and pasted.
- Nothing is stored: the copy lives in the open pages of the origin and goes with them. Same-origin
  pages only (BroadcastChannel).

### Consequences

- Good: in-document and cross-page keyboard paste work on an engine that keeps only text/plain.
  A paste of the editor's own copy on other engines is unchanged, since the custom type is read
  first.
- Bad, on every engine (the check cannot tell which engine dropped the types): when a page of the
  origin holds the newest copy and another application then puts exactly that copy's text on the
  clipboard as plain text only (no HTML, no file), the paste places the copied elements rather than
  that text; for a copy of elements without text, an empty clipboard pastes the copy rather than
  nothing, as a menu Paste already does with the editor's own copy.
- Cost: every copy is posted to the origin's other editor pages (up to a payload's size), and a
  page that opens receives the newest copy once, from its maker. A copy made while
  no other editor page is open is not known to a page opened after the copying page has closed.
- The e2e `clipboard.cross-document.spec.ts` emulates the engine in every project by keeping only
  text/plain in `DataTransfer.setData`; the previous-playwright (webkit) nightly is the engine
  evidence.
