---
status: accepted
date: 2026-10-25
decision-makers: harness (M18.3; existing FR-LIB-004/005/006 and NFR-SEC-001, subject to independent review)
---

# ADR-0049 — Shape imports share sanitization, inert paint and bounded decoding

## Context and Problem Statement

SVG import must produce usable shapes with anchors, not boxes that discard the artwork.
A single routing outline cannot represent every painted subpath, hole, gradient or clip.
Existing `ShapeDef` has an outline and stroke decorations; it cannot yet preserve arbitrary
sanitized SVG paint. Iconify supplies SVG bodies and aliases. draw.io libraries supply
stencils, model fragments or image entries; they are not all standalone SVG files.

The existing pure `sanitizeSvg` rebuilds markup from an allowlist with bounded depth,
node count and text size (ADR-0150). `readZip` already bounds inflated entries and totals
(ADR-0153). Replacing either with an unrelated importer would duplicate a security boundary.

## Decision Drivers

- FR-LIB-004: 50 fixture SVGs become 50 usable definitions, each with at least four anchors.
- FR-LIB-005: collection icons and aliases remain searchable, with geometry/transforms intact.
- FR-LIB-006: at least 90 percent of each representative draw.io fixture library imports.
- NFR-SEC-001: no scripts, handlers, external references, XML entities or archive traversal.
- Import behavior is shared by CLI and editor; I/O and file picking remain host adapters.

## Considered Options

1. **Render every input as an opaque image.** Preserves many appearances but loses editable
   paint/token mapping and useful shape geometry. Rejected as the general representation.
2. **Reduce every input to one path or bounding rectangle.** Small, but loses holes, layered
   fills and gradients; a passing count could conceal unusable imports. Rejected.
3. **Validated inert paint plus a separate routing outline.** Chosen. More contract work,
   but retains appearance and safe geometry without executable SVG or new parsing dependencies.

## Decision Outcome

### One checked paint boundary

Introduce a declarative SVG paint tree for imported `ShapeDef` artwork. Its node names,
attribute names and values come from the existing sanitizer allowlist; it carries data,
never raw HTML, JavaScript, handlers or externally resolved URLs. The schema lives in the
lower shared data layer so core can validate a directly supplied pack without depending
on format. Format owns XML tokenization/conversion; render consumes validated nodes.

Extract shared allowlist/value checks as a separate refactor, keeping every existing
`sanitizeSvg` corpus result and resource bound unchanged. Add bounded paint-tree validation
before recursive schema/render work. Direct pack input must receive the same validation
as an imported SVG; a caller cannot bypass it by claiming that data was already sanitized.

Render only allowlisted SVG nodes through normal React/SVG attributes and text nodes,
not `dangerouslySetInnerHTML`. Local IDs and every fragment reference are scoped to the
shape instance. Reject cyclic/dangling paint references and invalid/nonfinite geometry.
The tree retains supported fills, holes, gradients, clips, transforms and text under the
existing allowlist. Existing unsupported SVG features remain diagnostics, not new permissions.

Add the optional artwork contract, its core parser, SDK API report and renderer tests in
one dedicated implementation commit with a new implementation ADR supplementing
ADR-0048/0049; do not rewrite an accepted ADR in place. Legacy definitions still
render their existing outline/decorations. Newly serialized artwork must round-trip in
used-definition bundles; no document record changes are implied by this decision alone.

### SVG conversion

Sanitize first; derive a positive local viewport and normalize dimensions/transforms
consistently for paint, outline and anchors. Retain a valid existing perimeter when it
represents the painted boundary. For multiple filled components, derive the boundary of
their union when representable; otherwise use the painted bounds and emit an explicit
outline-fallback diagnostic. Stroke-only and otherwise difficult outlines use the same
reported fallback. Never replace the visible artwork with that fallback rectangle.

Every accepted shape gets at least north/east/south/west anchors. Optional colorization
maps selected checked paint colors to existing theme-token references; it does not evaluate
CSS or invent token names. Preserve original checked colors when the option is disabled.
Empty, unrenderable or invalid inputs do not count as imported shapes.

### Batch and host boundaries

A shared pure conversion service takes bytes/text, options and provenance and returns
accepted definitions plus per-input diagnostics. The editor supplies file/folder picking;
the CLI supplies filesystem paths and its existing JSON result envelope (ADR-0036).
Neither host maintains a different converter. Missing licensing provenance is collected
under ADR-0050 before producing a distributable pack; never assume an upstream asset is MIT.

Use existing `readZip`, its inflated-byte caps and the loader's path policy: reject absolute,
parent-traversal and duplicate normalized paths; do not extract files to arbitrary paths.
Keep the loader's limits: 4096 archive entries, 128 MiB per entry and 256 MiB total
(`loader-core.ts`), rather than the ZIP primitive's larger defaults. Enforce
`MAX_SVG_CHARS` (2 Mi characters), 20,000 nodes and depth 64 on each decoded SVG.
Bound XML/JSON and compressed input bytes before parsing; bound inflated bytes before
URI decoding, and enforce the decoded text limits again. Never use unbounded inflate.
No fflate dependency is added: the older M18 plan predates ADR-0153.

### Iconify

Resolve the collection's defaults, icon-specific viewport and rotation/flip properties,
then bounded alias chains with cycle/missing-parent diagnostics. Convert each resolved
body through the same SVG path. Preserve every valid icon/alias ID and search metadata;
retain hidden entries for compatibility, while normal search respects their hidden flag.
Do not fetch icons, external resources or license metadata silently during conversion.

### draw.io

Parse bounded XML without DTDs or entity expansion. Support stencil geometry and
`mxlibrary`'s JSON entry array, including escaped uncompressed XML and bounded compressed
model fragments. Decode base64, then bounded raw DEFLATE (without a zlib header), then URI decoding;
never evaluate model strings, styles, scripts or expressions as code.

Map supported stencil paths, primitives, styles and connection points into the same
checked shape/paint representation. Treat model fragments as library entries; this does
not implement M31 document import. Decode supported embedded SVG image entries through
the sanitizer; unsupported image/model/stencil constructs receive entry-level diagnostics.
Keep every failed or unsupported entry in the import-rate denominator. A malformed or
empty library fails rather than reporting a vacuous 100 percent result.

### Fixtures and confirmation

Pin fixture sources, redistribution licenses and checksums before converter implementation.
The 50-SVG corpus must exercise distinct filled and stroke artwork, relative paths,
transforms, multiple subpaths/holes, local references, gradients, clipping and color mapping;
separate malicious fixtures cover the full existing NFR-SEC-001 corpus and new pack bypasses.
Compare rendered artwork as well as imported counts and anchors. Never substitute easier
fixtures after a failed measurement or count identical filler shapes as broad coverage.

Pin representative stencil and mxlibrary corpora, including compressed/uncompressed entries,
with expected entry counts. Require >=90 percent for each library, not a pooled average
that hides one failed format. Iconify fixtures exercise defaults, aliases, transforms,
cycles and search. M18's gate runs these cases plus the three-browser SVG import workflow.
CLI and editor must return matching definitions and diagnostics for identical inputs.

### Consequences

Good: safe data and appearance survive independently of routing approximations; all hosts
share converters and bounds. Bad: checked paint requires a schema/renderer extension and
an isolated sanitizer refactor before conversion. The backlog separates those commits.
Unsupported constructs remain visible failures, so fixture quality is part of the review.

## More Information

- [Iconify collection format](https://github.com/iconify/icon-sets#readme)
- [draw.io custom library format](https://www.drawio.com/docs/reference/format-custom-shape-library/)
- [draw.io compression and library encoding](https://github.com/jgraph/drawio/wiki/File-Format#compression)
- [draw.io stencil shapes](https://www.drawio.com/docs/manual/shapes/shape-complex-create-edit/)
- ADR-0048, ADR-0150 and ADR-0153; existing `sanitize-svg.test.ts` and `zip.test.ts`.
