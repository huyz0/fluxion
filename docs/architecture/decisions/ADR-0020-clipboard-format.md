---
status: accepted
date: 2026-10-01
decision-makers: harness (M7 "Decide before coding"; within FR-EDT-007, NFR-SEC-001, FR-DOC-005)
---

# ADR-0020 — The clipboard format: one versioned Fluxion payload in every representation each path allows

## Context and Problem Statement

FR-EDT-007 asks for copy, cut, paste and duplicate within and across documents and tabs. Paste
must keep the connections among the copied elements, and must also accept images, SVG and text
from other applications. 04-rendering-and-editor §3.5 sketches a `ClipboardPayload` and several
representations. The contract still needs to be fixed:
- what the payload holds;
- which clipboard formats carry it, in which browsers;
- how assets travel;
- how a paste treats the payload, which is untrusted input from any page (NFR-SEC-001).

The format is an external contract: another Fluxion version, another tab or another origin may
write it.

## Decision Drivers

- **Works in Chromium, Firefox and WebKit** (the E2E projects). Custom clipboard formats are not
  supported everywhere, and the async Clipboard API needs permission prompts for reading in some
  browsers.
- **Bindings survive** among copied elements (FR-EDT-007), with fresh ids through the `Random`
  port.
- **Cross-document**: assets and theme tokens the target lacks must still resolve.
- **Untrusted input**: a payload is validated like an opened file. SVG is sanitised, and there is
  no script-capable URL or raw HTML.
- **Forward compatible**: a newer minor payload pastes into an older editor, keeping unknown
  fields (FR-DOC-005).

## Considered Options

1. **One versioned JSON payload carried in every representation the path allows**:
   - the keyboard shortcuts use the copy and paste events' `DataTransfer`: a custom
     `application/x-fluxion+json` type, `text/html` with the payload in `<template data-fluxion>`,
     and `text/plain`;
   - menu commands use the async Clipboard API: one `ClipboardItem` with
     `web application/x-fluxion+json` where supported, plus the same `text/html` and `text/plain`.

   Paste reads the richest representation first.
2. **Web custom format only** (`web application/x-fluxion+json` through the async Clipboard API).
3. **Event `DataTransfer` only** (a custom type plus `text/html` and `text/plain` in the copy and
   paste events, with no async API).
4. **An app-private store** (BroadcastChannel or `localStorage`) holding the payload, with only
   a marker on the system clipboard.

## Decision Outcome

Chosen option 1, which is option 3 plus the async API for commands that have no clipboard event.

### Payload

```ts
interface ClipboardPayload {
  fluxion: 'clipboard';            // discriminator
  version: 1;                      // this ADR; a newer version pastes only its known fields
  schemaVersion: string;           // of the source document (migrated on paste like a file)
  sourceDocId: string;
  records: AnyRecord[];            // the copied elements (containers with their children),
                                   // bindings whose both ends are copied, step animations of them
  assets: { hash: string; mime: string; size: number; dataUrl?: string }[];
  themeTokens?: Record<string, string>;  // token → resolved value, for tokens the records use
  bounds: Box;                     // union of the copied elements, for placement
}
```

- An asset of **1 MB or less is inlined** as a `data:` URL. A larger one travels by `hash` only.
  It resolves when the target document (or the same editor's asset cache) already holds that
  hash. Otherwise the pasted image element points at a missing asset, which validation reports
  (FR-EDT-021).
- `themeTokens` are fallbacks. A token the target theme defines stays a reference, and a token it
  lacks is replaced by the resolved value.

### Writing (copy and cut)

Every write puts **all** representations on the clipboard **in one operation**. A write never
follows another: `navigator.clipboard.write` replaces the whole clipboard, so a second write would
wipe the first (M7.3 review F1).

- **Keyboard (Ctrl/Cmd+C, X):** only the DOM `copy`/`cut` event, through `event.clipboardData`
  (synchronous, no permission, all three engines). It sets:
  - `application/x-fluxion+json`: the payload. Engines keep custom `DataTransfer` types within the
    same browser, which covers every tab and document there;
  - `text/html`;
  - `text/plain`.

  `preventDefault()` keeps the browser's own copy out. The async API is not used on this path.
- **Menu, palette and context menu (Copy, Cut, Duplicate to clipboard):** there is no clipboard
  event, so the command makes one `navigator.clipboard.write([item])`. The single `ClipboardItem`
  holds:
  - `text/html` and `text/plain`;
  - `web application/x-fluxion+json`, only where `ClipboardItem.supports()` says so (Chromium).
- `text/html` is the selection rendered as static SVG, followed by `<template data-fluxion="1">`
  whose text content is the payload JSON. Other apps paste a picture.
- `text/plain` is the copied text in reading order (labels and text elements), one element per
  line. A whole screen's FluxScript is M12's addition.
- `image/png` (a rasterised selection) is **not** written in R1. It is additive later.

### Reading (paste)

- **Keyboard (Ctrl/Cmd+V):** the DOM `paste` event's `clipboardData` (synchronous, no permission).
  Web custom formats are not visible there (M7.3 review F2), so the order is:
  1. `application/x-fluxion+json`;
  2. the `<template data-fluxion>` in `text/html`;
  3. image files;
  4. `image/svg+xml`, or `text/plain` that parses as an `<svg>` document;
  5. other `text/plain`.
- **Menu Paste:** `navigator.clipboard.read()`, which may prompt. The order is:
  1. `web application/x-fluxion+json`;
  2. the `text/html` template;
  3. `image/png` or other image types;
  4. `text/plain` (SVG or text as above).
- The results of the later steps:
  - an image becomes an asset and an image element;
  - SVG goes through `sanitizeSvg`, then becomes an asset and an image element;
  - text becomes a kind `text` element.
- The first representation that yields a valid payload wins. A payload that fails validation
  falls through to the next representation. It is never partially applied.
- **The carrier HTML is untrusted** (M7.3 review F4):
  - `text/html` is parsed only with `DOMParser` into an inert document;
  - only the first `template[data-fluxion]`'s `content.textContent` is read;
  - nothing from the pasted HTML is ever inserted into the live DOM, assigned to `innerHTML`, or
    rendered.
- **Validation** treats the payload as an opened file:
  - Zod parse plus the referential layer, with rich text through `checkRichText` (ADR-0013);
  - a `schemaVersion` migration;
  - `data:` URLs accepted only for image MIME types, their bytes hashed and checked against `hash`;
  - SVG assets through `sanitizeSvg` (introduced in `format`, hardened in M10);
  - unknown fields kept (FR-DOC-005).
- **Remapping:**
  - Every record id is replaced through the `Random` port.
  - A binding survives when both of its ends were copied. Otherwise its endpoint becomes free at its
    last resolved point.
  - Elements are placed at the source position offset by +16 px per repeated paste of the same
    payload, or centred in view when the source screen is not the one shown.
  - The paste is one store transaction, so one undo step.
- **Cross-tab** needs nothing extra: tabs share the system clipboard, so the same path serves a
  paste in the same document, another document, another tab or another origin.

### Consequences

- Good: the keyboard path works in all three engines through the clipboard events, with no
  permission prompt. Within one browser, the custom `DataTransfer` type carries the payload even
  when a host rewrites `text/html`. Menu commands work without an event, and in Chromium they carry
  a format other sites cannot confuse with HTML.
- Good: one payload, one validator (the file one). Cross-document and cross-tab paste are the same
  code.
- Good: pasting into other apps gives a picture and the text.
- Bad: payloads with large inline assets make big clipboard entries (up to 1 MB per asset, before
  base64). Assets over the cap may arrive missing in another document. Validation names them, and
  the user re-adds them.
- Bad: across browsers, or after a round trip through another app, only `text/html` survives. If
  a host rewrote it and the `<template>` is lost, the paste falls back to text or picture.
- Bad: two write paths and two read paths. Each has its own test (Confirmation).
- Neutral: the payload format is a contract. A change needs a `version` bump and an ADR, and older
  editors keep pasting the fields they know.

### Confirmation

- M7.21: the unit test "FR-EDT-007: a pasted connector stays bound to the pasted shapes, all with
  fresh ids"; `e2e/clipboard.copy-paste.spec.ts`.
- M7.22: `e2e/clipboard.cross-document.spec.ts` on chromium, firefox and webkit uses the keyboard
  path, and on chromium it also uses the menu path, which carries the web custom format.
- Unit tests with fake `DataTransfer` and `ClipboardItem` pin each reader's order:
  - a payload present only in the custom type;
  - a payload only in the `text/html` template;
  - a template beside an `<img onerror>` that never runs, and a `text/html` with no template, which
    falls through to text;
  - one `navigator.clipboard.write` call carrying every representation.
- M7.23: "NFR-SEC-001: pasted SVG loses its scripts and event handlers" over the security corpus
  subset; `e2e/clipboard.system-paste.spec.ts`.
- A unit test covers a payload that fails validation: it is never applied, and the next
  representation is tried.

## Pros and Cons of the Options

### Every representation the path allows (chosen)

- Good: every engine has a working keyboard path, commands work without an event, and other apps
  get useful content.
- Bad: two write and two read paths to test, and one more parser (the HTML template).

### Web custom format only

- Good: simplest, and cannot collide with other HTML.
- Bad: web custom formats are Chromium-only today, and they are not exposed to paste events at
  all. Keyboard paste would need an async read and its permission prompt, and cross-document paste
  would fail in Firefox and WebKit. Other apps get no picture or text.

### Event `DataTransfer` only

- Good: synchronous, no prompts, and works in all three engines. A custom type survives within the
  browser.
- Bad: needs a clipboard event, so the palette and context-menu Copy and Paste (M7.24, M7.25) could
  not work, since `document.execCommand('copy')` is deprecated. It is kept as the keyboard half of
  the chosen option.

### App-private store

- Good: no size pressure on the system clipboard, and assets could stay by reference.
- Bad: does not cross origins or browser profiles. It goes stale against what the user copied
  elsewhere, since the system clipboard and the store disagree. `localStorage` is shared across
  the origin's tabs but is synchronous and size-capped. It adds a second source of truth to keep
  consistent.

## More Information

- 04-rendering-and-editor §3.5 (payload sketch), 08-file-format (validation layers, `.flux.json`)
- ADR-0013 (rich text), ADR-0012 (ids)
- docs/milestones/M7.md "Decide before coding", rows M7.21–M7.23

### Amendment (M7.22): browsers and the custom type

- **Chromium** keeps `application/x-fluxion+json` on the clipboard for any page of the browser, and the async path adds
  `web application/x-fluxion+json` (read back only through `navigator.clipboard.read()`, never in a paste event).
- **WebKit** keeps a custom `DataTransfer` type per origin: a paste from another origin does not see it. The
  `text/html` template is what survives there, so every write puts the payload in the template as well, and the reader
  falls back to it. The E2E asserts the custom path within one origin only.
- **Menu Paste** asks for `navigator.clipboard.read({ unsanitized: ['text/html'] })`, so a browser that sanitises the
  clipboard's HTML does not strip the template; a browser that does not know the option is asked again without it.
- **Assets** travel as records, with their bytes inlined as an image `data:` URL when the editor holds them and they are 1 MB
  or less. No host holds asset bytes before the asset store (M10), so until then a pasted image element keeps its source
  asset id and names a missing asset unless the target already holds one with the same hash; validation reports it
  (FR-EDT-021). The hash of inlined bytes is checked when the store arrives.
