---
status: accepted
date: 2026-10-25
decision-makers: harness (M18.46; implementation of accepted ADR-0049)
---

# ADR-0177 — Shared decoded SVG attribute policy

## Context and drivers

FR-LIB-004 and NFR-SEC-001 require import conversion and directly supplied paint trees to
share the sanitizer's checks. Core cannot depend on format (ADR-0049). This extraction must
preserve existing sanitized text, removal counts and resource limits before adding artwork.

## Options

- Copy the checks into core: avoids an API addition, but two security boundaries would drift.
- Move the XML sanitizer into schema: shares behavior, but puts tolerant parsing and markup
  serialization in the data layer and exposes more API than direct paint validation needs.
- Move only decoded attribute checks and element predicates into schema: selected. It keeps
  the policy below core/format, with one allowlist and a small pure public surface.

## Decision

Add `SVG_POLICY_LIMITS`, `isSvgElement`, `isSvgTextElement`, `checkedSvgAttribute` and the
`CheckedSvgAttribute` return type to schema. The limits object is immutable; private sets and
allowlists are never exported. Limits stay 2 Mi characters, depth 64 and 20,000 nodes.

`checkedSvgAttribute(element, name, value)` accepts a decoded attribute value, trims it,
and returns a normalized `{ name, value }` or undefined. It rejects unknown elements and
attributes, external/executable values and unsupported functions under the existing policy.
`xlink:href` normalizes to `href`; only local fragment syntax is accepted. Style declarations
are filtered and normalized exactly as before. This is not a full CSS/geometry parser.

Format retains entity decoding, tolerant XML parsing, escaping, duplicate handling, removal
counting and serialization. Its existing `MAX_SVG_CHARS` export remains compatible and reads
the shared limit. No document field, version, migration or serialized shape changes here.
The schema API is additive (minor); format receives a behavior-preserving patch changeset.

These checks do not establish graph safety: bounded tree traversal, ID scoping, reference
resolution/cycles and geometry validation belong to M18.47. Callers must not treat one
accepted attribute as proof that an entire paint tree is safe to render.

## Consequences and confirmation

The benefit is one policy for markup and future data validation; the cost is a public API
whose normalization rules must remain stable. Existing sanitizer tests and every security
corpus expected output remain unchanged. Freeze pre-refactor `inspectSvg` text/removal counts
for all 50 import fixtures and all 17 hostile SVG fixtures, then require exact equality.
Test public predicates/attributes, hostile values, prototype-like names and immutable limits;
retain character/depth/node boundary tests. Run full schema/format suites, regenerate API
reports and obtain independent review before publication. No threshold or permission changes.

## References

- ADR-0049 (accepted extraction plan), ADR-0150 (existing SVG sanitizer).
- `packages/format/src/sanitize-svg.ts`; `specs/security/corpus`.
