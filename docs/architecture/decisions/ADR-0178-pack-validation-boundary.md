---
status: accepted
date: 2026-10-25
decision-makers: harness (M18.12; implementation of accepted ADR-0048/0050)
---

# ADR-0178 — Declarative pack validation and explicit license policy

## Context and drivers

FR-LIB-003 and NFR-LIC-003 require strict, licensed JSON packs without changing the existing
runtime `PackSpec`. ADR-0048/0050 define the envelopes and credits, but need concrete source
records and a pure policy boundary. Category loading/hashing belongs to M18.13; persistence
and complete paint-tree validation belong to M18.14/M18.47.

## Options

- Copy repository license allowlists into core: convenient, but copies drift and can confuse
  code/font exceptions with content permission. Rejected.
- Import the Node gate into core: shares current policy, but violates pure package layering.
  Rejected.
- Require a pure license-policy input to the serialized validator: selected, as ADR-0050
  permits. Distribution/import adapters must supply the content policy; no permissive default.

## Decision

Core exports documented pack index/category/credit types, structural schemas and parsers.
SDK re-exports them; existing `definePack` and `PackSpec` keep their behavior.
`parseShapePackIndex(input, licensePolicy)` and `parseShapePackCategory(input, index,
category, licensePolicy)` return Results with JSON-pointer `FLX_PACK_INVALID` diagnostics.
The policy is a function accepting an SPDX expression and returning true only when permitted.
It is required, must check known IDs/expression semantics, and is applied to the pack and
all credits (and definition overrides for categories). Missing/throwing policy fails closed.
This injection is not evidence of ownership or a new grant of redistribution rights.

The index retains ADR-0048's exact envelope, namespace/exact-semver version, relative category
paths and SHA-256 hashes. It has at least one category and definition. No geometry or unknown
fields enter the index. IDs are unique, namespace-bound and name existing categories.

Each credit retains its nonblank ID, license, attribution, notice and source. Its optional
nonempty, unique definitionIds list names indexed definitions; absent means global coverage.
Credit IDs are unique and every definition is covered. Preserve original notice/source text.
Concrete source records are either `{ kind: "original", author, statement }` or
`{ kind: "upstream", reference, sha256, revision?, modifications? }`. Original declarations
must be explicit; upstream bytes are pinned by SHA-256 even when no revision is available.
References are inert text, not fetched URLs. This adds no HTML or code permission.

A category has only formatVersion 1.0 and definitions. Revalidate its index with the supplied
policy, then require exactly the assigned definition IDs, without duplicates, and validate
each ShapeDef through the existing parser. Index labels are authoritative: ShapeDef has no
name field. Optional definition category/keywords must agree when supplied; missing optional
metadata is not invented or written into the definition. Optional definition licenses are
checked independently and never replace source-credit obligations. Failure returns no partial
accepted category. Hash verification operates on original bytes in M18.13's injected loader;
this object parser cannot claim to verify bytes it does not receive.

Structural schema exports and generated JSON Schema describe the wire shape; semantic
membership, expression/geometry and license-policy checks still require the parser. Saved
record schema stays 1.7. Public API changes are additive and receive minor changesets.

## Consequences and confirmation

Pure callers can validate packs without I/O, and policy stays explicit. The cost is that
host adapters must supply the existing content policy rather than call a structural schema
and claim complete validation. M18.33 verifies that adapter/distribution policy against the
repository allowlists, including AND/OR semantics and code/content distinctions.

Add valid wire fixtures and malformed cases for absent credits/notices, uncovered IDs,
unknown/mismatched IDs/categories, invalid version/path/hash, duplicate credit/definition IDs,
unknown fields, invalid definitions and rejected source/override licenses. Verify every
valid category definition produces a nonempty outline via existing geometry evaluation.
Exercise policy exceptions as diagnostics and preserve old runtime PackSpec tests. Generate
schema/API reports; review the implementation before publication. No existing policy floor,
license allowlist or document format changes.

## References

ADR-0048, ADR-0050, `packages/core/src/shape/shape-def.ts`, `packages/sdk/src/pack.ts`.
