---
status: accepted
date: 2026-10-04
decision-makers: harness (M10.3; within FR-AST-001, FR-AST-002, NFR-SEC-001, NFR-PORT-004 and architecture/08-file-format.md §6; no runtime dependency)
---

# ADR-0025 — The sanitizer and image encoding for M10: ADR-0150's allowlist reused, WebP from the browser, no wasm in M10

## Context and Problem Statement

M10 loads and saves files that carry untrusted bytes (SVG, rich text, raster images) and imports images by drop, paste
and picker. architecture/08 §6 sketches the pipeline: an SVG sanitizer "on a parsed XML tree", SVGO, WebP re-encode with
`OffscreenCanvas` in the browser and "a wasm encoder in the CLI", AVIF opt-in, font subsetting by a wasm module. The M10
plan asks which sanitizer (an own allowlist over a portable XML parser, or DOMPurify with a DOM shim) and which image
encoders. Since then ADR-0150 (M7.23) chose and built `sanitizeSvg` in `@fluxion/format` over a small tokenizer, with no
XML parser and no dependency; this ADR confirms and extends it, and settles encoding.

## Decision Drivers

- One sanitizer, identical output in Node and the browser, pure (no DOM, no `node:*`), no dependency.
- Allowlist, never denylist; what a reader misreads is dropped.
- Every external package added to the repository changes the lockfile and the gate-budget record; M10 should add none
  that it can do without (the cloud container cannot re-record the budget).
- FR-AST-002 is a Should; FR-AST-001 and the file format are Musts.

## Considered Options

1. **ADR-0150's tokenizer-based allowlist, widened case by case.** Exists, pure, tested against a corpus.
2. **A portable XML parser plus an allowlist walk.** A dependency, and the parser's notion of a document is the attack
   surface (ADR-0150 option 2).
3. **DOMPurify with a DOM shim in Node.** A DOM dependency in a pure package, two behaviours (a shim differs from a
   browser), and a denylist at heart.
4. **SVGO for minification.** A large dependency over an XML parser; its output would have to be sanitized again.
5. **Wasm encoders and decoders in the CLI (libwebp, mozjpeg, an AVIF encoder) and AVIF in the browser.** The
   documented plan; each is a dependency with a licence to check and a size to pay, and a lockfile change.

## Decision Outcome

Option 1 for sanitizing, with our own minifier instead of SVGO, and the browser's own encoders for images.

- **Sanitizer.** `sanitizeSvg` (ADR-0150) is the one SVG sanitizer, in `@fluxion/format`, applied at import, at load for
  every `image/svg+xml` asset and at render for markup that reaches the DOM. M10.9 widens its list case by case, each
  widening with a corpus entry in `specs/security/corpus/`. It is not replaced by an XML parser or by DOMPurify, and no
  XML parser enters the repository. The rich-text URL allowlist (`http:`, `https:`, `mailto:`, `tel:` and in-document
  `#` anchors; everything else, including `javascript:` and `data:`, becomes plain text) and `sanitizeHtml` (a wrapper
  that tokenizes pasted HTML with the same tokenizer and keeps `b i u s a br p ul ol li span` with `href` and `style`
  limited to the presentation list) live beside it, and a single `sanitize` entry in `format` is the only thing the rest
  of the code imports.
- **SVG minify.** `minifySvg` is part of the same module: it runs on the sanitizer's output (so on tokens that already
  passed), drops comments, metadata and editor namespaces, collapses whitespace, keeps `viewBox`, and rounds numbers to `max(0, 3 - floor(log10(side)))`
  decimals, `side` being the viewBox's larger side (a `0 0 1 1` icon keeps 3 decimals, `0 0 24 24` keeps 2, `0 0 100 100`
  keeps 1, `0 0 1000 1000` keeps none, a side below 1 keeps 6); a file without a viewBox is not rounded. FR-AST-002's "minify" is this; SVGO is not added.
- **Raster decode and encode in the browser.** Decode with `createImageBitmap`; downscale so the longest side is at most
  2560 px; encode with `OffscreenCanvas.convertToBlob({ type: 'image/webp', quality: 0.82 })`. The longest-side cap is a
  setting (`maxImageSide`, default 2560, FR-AST-002 "configurable"). The WebP replaces the original only when it is
  smaller and the original is not animated. `createImageBitmap` shows only the first frame and says nothing of animation,
  so animation is read from the bytes before anything is decoded: a GIF with more than one image descriptor, a PNG with
  an `acTL` chunk (APNG), a WebP whose `VP8X` flags have the animation bit set. An animated image, and any image the
  browser cannot decode or encode, is kept byte for byte. Where an engine lacks WebP encoding (the studio checks once
  with a 1-pixel probe) the original is kept and the import says so.
- **AVIF.** AVIF is accepted on import (sniffed by its `ftyp` brand, decoded by the browser, kept as it is) and is never
  encoded in M10. The documented "AVIF opt-in, wasm, lazy" is deferred with the wasm encoders below.
- **No wasm in M10.** The CLI and the MCP server import images without re-encoding (sniffed, size-capped, kept as they
  are; downscale and WebP re-encode are the studio's, where the browser provides them). Font subsetting (hb-subset wasm,
  `08` §6) is not done in M10: a font is embedded whole, each with its licence and copyright line (ADR-0022), and M10.15
  records the cost. The wasm encoders and the subsetter return as one later row with a dependency decision of their own
  (licence check, size, the budget record) when the lockfile can change.
- **Amendments to other documents.** ADR-0022's "deferred to M10: subsetting" now reads "deferred past M10" (its amendment
  below this ADR's date); `08-file-format.md` §6 and `docs/milestones/M10.md` (rows 12 and 13, the risk table) are
  amended to say SVGO, wasm encoders, hb-subset and an XML parser are not part of M10. ADR-0003 was checked against §6
  and needs no change: it fixes the container and the CSP, not the encoders.
- **Pipeline order, fixed.** sniff by magic bytes, never by extension or declared type; refuse a mismatch; cap the bytes
  (50 MB per image, 5 MB per font, ADR-0022); decode; downscale; encode (browser only); sanitize (SVG only); hash;
  asset record. An asset the pipeline refuses is a diagnostic with a code, never a crash.

### Amendment (M10.26): what M10 builds of the sanitizer set

The rich-text link allowlist is `safeLinkUrl`, and it matches what `@fluxion/schema` already accepts as a link target (`http:`, `https:`,
`mailto:` and `#screen:<id>`), not the wider list above: `tel:` and a bare `#anchor` are not link targets in this schema version, so a link
that the sanitizer allowed and the schema refused would only break the document. `sanitizeAsset` applies `sanitizeSvg` to an SVG asset
before it is drawn, saved as a new asset or previewed; `loadFlux` keeps the verified bytes as they are and reports an `ASSET_UNSAFE` note
for an SVG that would change. **`sanitizeHtml` is not built in M10**: the editor's paste reads text, SVG and images only, so nothing would
call it, and a hand-written HTML sanitizer without a consumer is risk without value; backlog M10.27 holds it for the commit that adds
HTML paste, with its own corpus.

### Amendment (M11.44): one link rule in the schema, the views and paste

The amendment above claimed the schema accepts what a pasted link may become; it did not, because the schema and the rich-text views shared a looser
prefix test (`https://paypal.com@evil.example/` passed it). `safeLinkUrl` now lives in `@fluxion/schema` (`@fluxion/format` re-exports it), the schema's link
check (`FLX_TEXT_UNSAFE_LINK`) and the views' link marks use it, so a document whose link carries user information, markup characters or spaces is an error and
is drawn as text.

### Consequences

- Good: no new package in the repository for the sanitizer, the minifier or the images; the lockfile and the budget record
  stay as they are; one sanitizer for the loader, the paste path and the import.
- Good: Node and browser sanitizer output are the same bytes by construction; a corpus test runs in both.
- Bad: the CLI cannot downscale or re-encode an image, so a CLI-built document with a 4000 px photo is bigger than a
  studio-built one; the size budgets are measured on studio output.
- Bad: FR-AST-002 (a Should) is met in part: WebP re-encode, downscale and SVG minify, but no AVIF output (recorded here; the
  requirement text stays). No font subsetting until the wasm row; documents with CJK or several fonts are larger.
- Bad: `minifySvg` is ours to keep, less thorough than SVGO.

### Confirmation

- `NFR-SEC-001: every case of the security corpus is neutralised through load, render, save and reload`, run in Node and
  in the browser project, and `NFR-SEC-001: the sanitizer gives the same output in Node and in the browser`.
- `FR-AST-002: a 4000px JPEG imports as a WebP of at most 2560px` (browser project) and a case that keeps an animated GIF
  and an original smaller than its WebP unchanged.
- `FR-AST-001: an image is recognised by its magic bytes whatever its name says`, and animated GIF, APNG and WebP
  fixtures are kept unchanged.
