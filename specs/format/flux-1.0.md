# The Fluxion file format 1.0

Normative description of the containers `@fluxion/format` reads and writes, as implemented at the end of M10. The reasoning is in
[docs/architecture/08-file-format.md](../../docs/architecture/08-file-format.md) and ADR-0003; the requirements are FR-FIL-001..009,
FR-AST-001..005, NFR-SIZE-003/004, NFR-PORT-002/003, NFR-REL-001/002 and NFR-SEC-001/002. "Must", "must not" and "may" are meant as
in RFC 2119.

## 1. Containers

| Name | Media type | Extension | Role |
|---|---|---|---|
| Package | `application/vnd.fluxion+zip` | `.flux` | the unit of truth: a zip of the document, its assets and a manifest |
| Page | `text/html` | `.flux.html` | the same package bytes inside a page that carries the player and presents offline |
| JSON | `application/vnd.fluxion+json` | `.flux.json` | the document alone, canonical pretty JSON, for diffs and tests |

Conversion between a package and a page is lossless: the page holds the package's bytes, and reading it returns exactly those bytes.

## 2. The package

A package is a zip archive. A writer must produce the entries below in this order, and the same document must produce the same bytes.

| Entry | Method | Content |
|---|---|---|
| `mimetype` | stored | the text `application/vnd.fluxion+zip`, no extra field; always first |
| `manifest.json` | deflate | the manifest (§3) |
| `document.json` | deflate | `{ "schemaVersion": "1.0", "records": { <id>: <record> } }` |
| `theme/tokens.json` | deflate | the active theme's design tokens |
| `source/document.flux.yaml` | deflate | optional: the FluxScript the document came from |
| `assets/<sha256>.<ext>` | stored for WebP, AVIF, PNG, WOFF2 and video, otherwise deflate | one entry per distinct asset, named by the SHA-256 of its bytes |
| `preview.webp` | stored | optional: a cover thumbnail, at most 640 px |

- The zip codec is the package's own (ADR-0153): fixed entry order, entry timestamps `1980-01-01`, no extra fields, deflate level 6.
- Entries a writer does not know (a newer writer's, plugin bundles, snapshots) must be copied through unchanged when a file is saved again, and
  listed in the manifest.
- Entry names must not be absolute, contain `..`, repeat, or collide with the reserved names. A reader refuses such a file.
- Limits a reader enforces: at most 10 000 entries, 512 MB uncompressed, a compression ratio of at most 200:1.

## 3. The manifest

`manifest.json` is canonical JSON (keys sorted by code point, 2-space indent, LF) with these fields:

| Field | Meaning |
|---|---|
| `format` | the text `fluxion` |
| `formatVersion` | the container version, `1.0` |
| `schemaVersion` | the document schema version, copied from `document.json` |
| `app` | `{ "name": "fluxion", "version": <writer version> }` |
| `generator` | optional: what produced the file |
| `title`, `created`, `modified` | from the document record; ISO 8601 |
| `entries` | for every entry except `mimetype` and `manifest.json`: `{ "sha256": <hex>, "size": <bytes> }` |
| `plugins` | the plugin lock (empty when the file uses none) |
| `bakes` | `{ "routes": boolean, "snapshots": boolean }`: which derived data the file holds |
| `source`, `preview` | the entry names, when present |

A reader must keep manifest fields it does not know when a file is saved again. A hash that does not match its entry is a warning for data
and blocks a plugin.

## 4. Assets

- Every asset is stored once, named by the SHA-256 of its stored bytes; two records with the same bytes share one entry.
- An asset record holds `hash`, `mime`, `size`, and for images `w` and `h`. Only referenced assets are written.
- Images are recognised by their magic bytes, never by name. A raster wider or taller than 2560 px is scaled down to that and stored as WebP
  where that is smaller. SVG is rebuilt from an allowlist (no scripts, event handlers, `foreignObject`, external references).
- Fonts are stored whole as WOFF2 with their recorded metrics, copyright line and licence. The fonts a document references, and no others, are
  embedded when it is saved; an opened file's fonts are loaded from its own bytes.

## 5. The page

A `.flux.html` is an HTML document with, in this order inside the first 4 kB, the markers `<meta name="fluxion:format" content="1.0">` and the
comment `<!-- fluxion:package v1 -->`, and then:

1. one `<meta http-equiv="Content-Security-Policy">` with `default-src 'none'` and `connect-src 'none'`, naming the SHA-256 of each inline script;
2. a `<script type="application/octet-stream" id="fluxion-package" data-encoding="base64" data-sha256="…">` holding the base64 of the package;
3. the player as a classic inline script, then a short boot script that hands the package bytes to the player.

A reader finds the package by scanning the text for the first such block and decoding it; it must not parse the page as a document or run any
script in it. A page opens from `file://` with the network blocked and makes no external request. The title and generator written into the page are escaped so
they cannot end the data block.

## 6. The JSON variant

`.flux.json` is `document.json` serialised canonically: keys sorted by code point recursively, 2-space indent, LF, a trailing newline,
geometry rounded to 1e-3, `-0` written `0`, no `undefined` or `NaN`. It holds records only; assets live next to it or in a package.

## 7. Opening a file

Sniffing: a zip whose first entry is `mimetype` is a package; text with both page markers is a page; JSON with a document is a `.flux.json`.
The loader never throws. It unpacks, verifies, parses, migrates, validates, repairs and, as a last step, salvages every complete record it can,
and reports what it changed. A file with a newer major `formatVersion` or `schemaVersion` opens read-only, and a save over it is refused.

## 8. Versions

Minor versions are additive: an older reader preserves what it does not understand. A major version needs a converter and an ADR. Golden
packages, pages and JSON files of every released version are kept in `packages/format/__fixtures__/` and are loaded, migrated and round-tripped
by the tests.

## 9. Size budgets

For the 20-screen reference document (`fixtures/docs/doc20.flux.json`) the package must stay within `DOC20_FLUX_BYTES`
(`scripts/gates/thresholds.mjs`); the page's budget is under review (see NFR-SIZE-003).
