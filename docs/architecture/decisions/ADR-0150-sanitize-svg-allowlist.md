---
status: accepted
date: 2026-10-02
decision-makers: harness (M7.23; within NFR-SEC-001, FR-EDT-007)
---

# ADR-0150 — `sanitizeSvg` rebuilds an SVG from an allowlist over a small tokenizer

## Context and Problem Statement

M7.23 pastes SVG from the system clipboard, and M10 imports and loads it. An SVG is markup that can run
script (`<script>`, `onload`, `javascript:` links), load other documents (`<use href>`, `<image>`,
`<foreignObject>`, CSS `url()` and `@import`) and expand entities. NFR-SEC-001 and the security standard
(rule 2) require an allowlist, in `format`, applied at load time and at render time for anything that reaches
the DOM as markup. `format` is a pure package: no DOM, no `node:*`, the same output in Node and the browser.

## Decision Drivers

- Allowlist, never denylist; what a parser misreads must be dropped, not passed on.
- Pure and portable: no `DOMParser`, no Node-only parser, no runtime dependency.
- The output is again an SVG that a browser draws from an `<img>` or inline, with nothing external in it.
- M10 hardens it (a corpus run through load → render → save), so the shape must extend.

## Considered Options

1. **Parse with `DOMParser` and remove what is bad.** A denylist over a live parse; browser-only; the parse
   itself is where mutation-XSS lives.
2. **A portable XML parser library** (then walk and filter). A dependency, and a parser's idea of a document is
   the attack surface.
3. **A small tolerant tokenizer, then build a new document from the allowlist.** No dependency, pure, and
   anything it misreads is lost rather than kept.

## Decision Outcome

Chosen option 3. `sanitizeSvg(text): string | undefined` in `@fluxion/format`:

- reads elements, attributes and text only; comments, processing instructions, doctypes (internal subsets
  and entity declarations included) and unknown entities are dropped; CDATA is text;
- keeps an element only if it is on the list (shapes, text, gradients, clip paths, masks, markers, `use`,
  `symbol`, `defs`, `title`, `desc`); an element off the list is dropped with everything inside it, so
  `script`, `style`, `foreignObject`, `a`, `image`, `animate`, `set`, `iframe` never survive;
- keeps an attribute only if it is on the list for its element or is a presentation attribute; the file's own
  `xmlns` declarations are not kept and the root gets the SVG namespace;
- checks every value after decoding character references: no `javascript:`, `data:`, `http(s):` and similar
  scheme (white space and control characters inside it ignored), no markup, CSS escape, comment,
  `expression(` or `@import`, and every `url(` names an id of this file (`url(#id)`);
- allows `href` / `xlink:href` only as `#id` of the same file;
- filters `style` to declared properties of the presentation list with safe values;
- writes the tree back with text and values escaped, caps the input (2 MB), the depth (64) and the element
  count, and refuses a file with no `svg` root.

The output is a fixed point: sanitising it again changes nothing (tested over the corpus).

### Consequences

- Good: pure, no dependency, one behaviour in every host; unknown markup costs fidelity, not safety.
- Good: `specs/security/corpus/svg-*.svg` pins each attack by name; a bug fix adds its payload.
- Bad: fidelity. Filters, patterns, images, fonts and CSS classes are dropped in M7; an imported SVG loses
  them. M10 widens the list case by case, each with a corpus entry.
- Bad: a tolerant reader differs from a browser's on malformed markup. That is safe by construction (the
  output is rebuilt from tokens that passed), but a badly formed file may lose more than a browser would show.

### Confirmation

- `packages/format/src/sanitize-svg.test.ts`: "NFR-SEC-001: pasted SVG loses its scripts and event handlers"
  over every `specs/security/corpus/svg-*.svg`, and the allowlist, reference, value, text and cap cases.
