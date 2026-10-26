---
status: accepted
date: 2026-10-26
decision-makers: harness (M18.47; independently reviewed implementation plan)
---

# ADR-0180 — Bounded artwork on shape definitions

## Context

ADR-0049 selected inert SVG paint plus a separate routing outline. M18.46 extracted the
shared decoded-value policy and M18.12 introduced declarative pack validation. Neither
currently permits imported artwork in ShapeDef. A caller can register a definition directly,
so validating only imported XML would leave a second, unchecked rendering path.

## Decision

Add optional artwork containing a finite positive viewport and an inert tree of allowlisted
SVG elements, string attributes and text children. The schema package owns the data types
and bounded structural validation. The lightweight `isSvgArtworkData` predicate keeps the player free of Zod (ADR-0026);
the closed ShapeDef Zod contract lives in core and uses the same structural preflight, and differential tests cover agreement.
Core checks numeric geometry, reference resolution,
cycles and expanded rendering cost; ShapeDef and pack parsers use the same checks.

Run iterative raw preflight before any recursive schema or rendering traversal. Keep the
shared SVG policy's input/depth/node limits and count strings and text nodes. Reject object
cycles, shared object aliases, foreign prototypes and unknown structural fields. Normal JSON
copies are counted separately. A rejected attribute or style declaration rejects direct pack
artwork; the validator must not silently bless a tree after dropping executable content.

Validate complete numeric/path/transform grammar and finite composed arithmetic. IDs are
unique and all references remain local, resolve to compatible element kinds, and are acyclic
when combined with containment. Bound expanded graph cost as well as stored nodes, so a
small acyclic use graph cannot create an exponentially large rendered scene.

Render checked nodes with normal React SVG elements and text nodes, never raw markup.
Every instance receives its own useId-derived scope, including IDs in styles and local URL
references. A manually registered malformed definition renders PlaceholderView. Existing
SSR identifier prefixes remain authoritative. Artwork fits its viewport into the shape box using `preserveAspectRatio="none"`;
its separate outline continues to serve routing and hit testing. Definitions without artwork
retain the existing outline/decorations renderer.

Optional literal-color mappings contain only checked colors and existing TokenRef values.
The renderer resolves a mapped token through the theme's color resolver and validates its
result. A valid mapping emits a scoped theme CSS variable with a literal fallback, preserving
the renderer's color-only theme update behavior. Missing or invalid tokens fall back to the original literal. No raw token or arbitrary
CSS is injected into an SVG attribute.

## Compatibility and qualification

This is an additive ShapeDef contract, not a new document record. Update core/schema/SDK
API reports, structural category schema snapshots, minor changesets and round-trip fixtures
in the same commit as the renderer. Used-definition document storage remains M18.14 and
XML conversion remains M18.15. Old definition fixtures must still parse and draw unchanged.

Qualification includes malicious direct-pack and manual-registration probes, finite/invalid
geometry, resource and reference limits, round-trips, and actual browser paint checks for
fills, holes, gradients, clipping, transforms, text and instance ID collisions. Preserve all
existing correctness, security and hard bundle limits. Plan approval is not implementation
qualification; the final implementation requires fresh review and verification.
