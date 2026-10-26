---
status: accepted
date: 2026-10-26
decision-makers: harness (M18.15; existing FR-LIB-004/NFR-SEC-001; independent plan review passed)
---

# ADR-0187 — Preserve SVG paint and diagnose viewport routing fallback

## Context and Problem Statement

ADR-0049 promised representable union perimeters and painted-bounds fallbacks.
That would require a general layout/enclosure engine, although the product asks
for usable preserved artwork, routing outlines, anchors and explicit fallbacks.
This decision supersedes only ADR-0049's SVG-conversion perimeter/fallback-bounds
clauses. Its sanitization, provenance, corpus, host parity and batch rules remain.

Two rejected plans are preserved. They incorrectly flattened source viewports or
relied on native bbox/advance metrics for enclosing stroke and glyph paint.
A simpler invariant already exists: ArtworkView clips imported paint to its own
finite nested viewport. It is distinct from outer host effects and text labels.

## Decision Drivers

- FR-LIB-004: usable imported definitions; all frozen inputs retained.
- FR-SHP-005: useful and explicit routing/hit-test geometry.
- NFR-SEC-001: no executable SVG, external fetching or weakened validation.
- Preserve original paint independently of routing precision and host I/O.

## Considered Options

1. Implement general curved unions, stroke/marker envelopes and font ink layout.
   Precise routes are attractive, but this duplicates substantial renderer work
   and is unnecessary for bounded routing around complex icons.
2. Use native getBBox as the bound. Rejected: the current Chromium probe ignores
   stroke options, text boxes are not an ink certificate, and invisible elements
   still produce geometry.
3. Keep proven simple perimeters and diagnose a clipped-viewport rectangle for
   everything else. Chosen, conditional on preserving the clipping contract.

## Decision Outcome

Preserve the checked source SVG root and all nested viewport semantics. Derive a
positive finite natural viewport from a valid viewBox and absolute width/height;
viewBox-only input uses its width/height as natural size. Pixel and unitless root
lengths are initially supported; ambiguous relative/physical root dimensions
fail with an explicit unsupported-viewport diagnostic. Do not flatten to g,
recenter source geometry or replace the source viewBox. An outer artwork viewBox
0,0,naturalWidth,naturalHeight surrounds the retained root so native source
viewport fitting happens once. Unsupported original root x/y offsets or dimensions
must fail rather than silently changing the source positioning.

Keep core semantic validation for geometry, local references and expansion.
Strict import refuses every sanitizer removal; clipboard sanitization stays
unchanged. All 50 frozen SVGs currently have zero sanitizer removals, which is
not a claim of converter success.

The initial exact classifier accepts a single unrounded, unstroked filled rect
with no transforms, inherited effects, masks, clipping or opacity changes, and a
positive boundary wholly inside an origin-zero viewport with matching dimensions.
Express its perimeter and N/E/S/W anchors as fractions of natural width/height.
Other valid artwork gets M0 0 L{w} 0 L{w} {h} L0 {h} Z and viewport anchors, with
stable diagnostic `outline-fallback: viewport-clipped`. This is conservative
routing/hit-test geometry, not tight ink bounds or an exact silhouette. No arc
approximation or unimplemented Boolean operation is claimed exact.

The enclosure applies to imported artwork before outer effects and external
labels. Supported hosts must preserve nested artwork viewport clipping. It must
remain impossible for imported attributes to turn that clipping off. Host CSS
outside Fluxion's supported styling boundary is not a universal guarantee.

### Pure conversion and positive paint witness

`importSvgShape(input, options)` is an asynchronous pure-format orchestration
using an explicitly supplied host witness port. It sanitizes/validates, constructs
normalized artwork and routing data, obtains the witness and validates the final
ShapeDef. It returns the definition, stable diagnostics and required font faces.
It never reads DOM/files/network or fabricates licensing provenance.

Options provide the qualified definition ID, optional checked literal-to-token
mapping plus existing token references, explicit font-resolution context when
text is present, and a bounded witness callback. Every selected token must exist
in that supplied context; unmapped/disabled colors retain original values.

The witness request contains validated normalized artwork, resolved font faces,
canonical raster dimensions (longest side 1024, the other rounded up, each at
least1), and SHA256 content identity. Reply echoes that identity, confirms every
requested exact font face is loaded, and returns positive-paint/no-witness/error.
Only positive paint with matching identity and fonts succeeds. Rejections/throws
become diagnostics. No witness is an unsupported/no-visible-witness failure, not
proof of mathematical emptiness. There are no retry-to-green scales or loops.
Hosts bound a single request's time, concurrency and output pixels/bytes. A port
is an explicit trusted effect dependency like Hasher, not a self-authenticating
remote assertion. Unit fakes cannot qualify the frozen positive cases.

The production witness must observe only artwork paint: no screen background,
placeholder, selection, labels or outer effects. A transparent target is supported
where the renderer exposes alpha. An alternative is exactly two controlled opaque
backdrops (black and white) at the same canonical viewport. Disabling artwork must
produce each exact uniform backdrop; positive paint requires deviation from the
corresponding backdrop in at least one capture. The union of these deviations
provides occupied bounds. These are foreground-deviation bounds, not raw alpha.
Both artwork captures plus their two disabled-art controls are one bounded
observation, not retries or alternative scales.
Qualification compares original-source and mounted output on both backgrounds
under unchanged pixel limits, plus exact occupied bounds and preserved authored
geometry. Geometry signatures preserve ordered tree structure, text content, source element
names, coordinates, paths, transforms, viewport/stroke attributes and inline
styles. Scoped IDs and all local references are canonicalized consistently while
preserving their relationships; resolved text font attributes are checked separately. Negative controls
must detect whole-image translation, stroke-width changes and movement of an
interior feature even where the pixel comparator's antialiasing exemption applies.
Source references never reuse the converter's normalized tree. Missing
font capability fails before positive paint is accepted. The canonical font and
theme context is the same in browser and CLI; numeric definitions are pure, and
all frozen inputs must pass every supported host. Marginal subpixel inputs that
cannot produce a witness are reported unsupported, never silently accepted.

### Font fidelity and persistence

Unspecified SVG text requires an explicit host-selected bundled face; initial
supported context is Inter normal400 with its existing pinned hash. Normalize
family/weight/style in artwork so it cannot silently inherit a different face.
The initial text profile is simple horizontal printable ASCII with no textLength,
per-character positioning arrays or unsupported typography; other profiles fail
explicitly. Text-bearing use references are initially unsupported because instance font
inheritance must not be replaced with definition ancestry. A host must verify coverage as well as exact face identity.
An authored explicit face must match a supplied available face or fail; no silent
substitution. Required faces are returned to host adapters for existing asset
embedding/licensing and used-font retention. Missing requested weights/styles or
wrong bytes must fail. A positive rectangle behind a label does not prove font
fidelity: text-specific render parity and saved-font identity tests are required.
No new ink-metadata engine or runtime font parser is introduced.

M18.15 owns this pure service and real-renderer qualification. M18.16/17 own
batch/CLI/UI adapters, distribution provenance and consumption of returned font
dependencies through their save/embedding paths; those rows cannot close without
offline font fidelity and CLI/editor parity. No complete host import UI is claimed
by the pure service's commit.

### Consequences

Good: preserved rich paint and bounded usable routing without a second SVG engine.
Bad: complex/whitespace-heavy icons use coarse viewport hit regions/anchors; their
fallback is visible in diagnostics. Unsupported visibility/font capabilities are
failures, not imported counts. The witness requires real host rendering, bounded
per batch. Conservative route quality still needs practical usability checks.

### Confirmation

Existing live component probe: six cases passed in the pinned image across
Chromium/Firefox/WebKit, viewBox origins0/20, full-page outside-pixel assertions,
and clipping-off negative controls. Its first run's invalid nested getBoundingBox
assumption is retained as failed evidence; it was corrected to the actual shape
container and declared viewport. These probes establish clipping, not conversion.

Permanent tests must retain that nonvacuous invariant and host-effects distinction.
Converter tests cover strict hostile/invalid inputs, viewport fitting/percentages,
exact-rect versus diagnosed fallback, four anchors at resized dimensions, token
mapping, no-witness/port failure/wrong identity, required fonts and resource bounds.
Real frozen-input renderer witnesses and appearance checks cover text, masks,
markers and clips; batch50/50 and interactive three-engine flows remain in M18.16/17.
No fixture replacements, removed denominators, relaxed pixel limits or retries.

Implemented qualification: pinned three-engine run passed168/168 with zero retries,
including all50 original sources, two viewport cases, two no-paint controls and
two clipping probes per engine. Exact-font bytes/ASCII coverage, structural
reference preservation and unchanged visual limits are checked. Batch/CLI/UI
qualification remains separate; this is not M18 completion.

## More Information

- ADR-0049, ADR-0180, ADR-0186, ADR-0022 and ADR-0148.
- SVG2 styling §6.8 and rendering §3.11: nested SVG overflow/viewport clipping.
