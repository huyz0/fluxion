---
status: accepted
date: 2026-10-26
decision-makers: harness (M18.78; independently reviewed plan, existing FR-LIB-004/NFR-SEC-001 scope)
---

# ADR-0186 — Reuse sanitized SVG data before serialization

## Context and Problem Statement

ADR-0049 requires the shape importer to share the existing bounded SVG sanitizer.
The sanitizer currently exposes markup only, while core's artwork contract accepts
inert decoded `SvgArtworkNode` data. Parsing the sanitized markup again would add a
second parser and another opportunity for inconsistent handling of hostile input.

## Decision Drivers

- FR-LIB-004: pure shared SVG import for CLI and editor.
- NFR-SEC-001: preserve the existing allowlist, resource bounds and security corpus.
- Keep parser refactoring separate from converter geometry and host behavior.

## Considered Options

1. Parse sanitized markup with a second reader. This retains the current API, but
   duplicates tokenization and escaping rules and adds work to every import.
2. Expose the raw reader tree. This avoids another parse, but leaks unvalidated
   attributes, namespaces and forbidden subtrees. Rejected.
3. Expose the checked tree before serialization. Chosen: one reader and one
   allowlist produce both decoded data and the existing escaped markup.

## Decision Outcome

Add `inspectSvgTree(input): SvgTreeInspection | undefined` to the format main API.
Its result contains `root: SvgArtworkNode` and the same `removed` count as
`inspectSvg`. The tree has decoded literal values and no injected namespace.
`inspectSvg` serializes the same checked tree; `sanitizeSvg` remains its wrapper.
Preserve exact existing markup output, attribute order, first-safe-reference-alias
precedence, allowed text handling, dropped subtrees and all resource caps.

This is syntactic sanitization, not semantic artwork qualification. Local fragment
references may still be dangling or cyclic, and geometry may be invalid. The shape
importer must validate viewport, geometry and references through core before
constructing/registering a `ShapeDef`. Removal diagnostics remain available for its
strict import policy. No renderer, file schema or licensing policy changes here.

### Consequences

Good: the importer can reuse checked data without a second parser or dependency.
Bad: callers must distinguish allowlisted syntax from fully validated artwork;
the public TSDoc explicitly states that boundary. Tree allocation now also occurs
for markup callers, within the existing depth/node/text bounds.

### Confirmation

`svg-tree.test.ts` verifies decoded data, rejected unsafe subtrees/attributes,
reference aliases, unresolved-reference semantics and unchanged input/depth/node
bounds. The frozen 67-input `svg-policy-compatibility.test.ts` requires exact prior
markup and removal counts; the sanitizer security corpus and full format suite
remain unchanged. Public API reports and the format changeset accompany this API.
M18.15 retains converter, anchors, outlines, token mapping and renderability tests.

## More Information

- ADR-0049, ADR-0150, ADR-0180; `packages/schema/src/svg-artwork-data.ts`.
- `packages/format/src/sanitize-svg.ts`; `packages/core/src/shape/artwork-schema.ts`.
