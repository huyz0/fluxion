---
status: accepted
date: 2026-10-26
decision-makers: harness (M18.74; independently reviewed implementation plan)
---

# ADR-0183 — Prepare deterministic used-shape entries from explicit sources

## Context

FR-LIB-009 and NFR-LIC-003, specified by ADR-0048/0050, require portable used geometry and source credits. ADR-0182 supplies
the validated saved envelope. A document must not need an unavailable distribution
index to resave an embedded subset, nor save thousands of unused definitions.

## Decision

Add a pure format preparation API, `prepareUsedShapePacks`, receiving a document,
explicit sources, builtin IDs, a content-license policy and injected ContentHasher.
`ShapePackSourceData` distinguishes distribution index plus resolved definitions
from an embedded `ShapePackSubset`. Validate each source; reject duplicate source
namespaces even when their versions match. Never infer builtins from namespace.

Collect distinct defIds from all shape records, including group descendants.
Every non-builtin ID must resolve. Select only used definitions, retain all global
credits, intersect scoped credits with used IDs and drop empty scopes. Preserve
notice, attribution, source and per-definition license text. Validate the result.
Sort namespaces, definitions, credits and scoped IDs; encode using canonicalJson,
which does not round geometry. Capture all canonical bytes and identity before
awaiting the hash port so asynchronous caller mutations cannot mix revisions.

Emit `plugins/<id>@<version>/defs.json` and typed `ShapePackDataLock` entries with
kind `declarative-shapes`, id, version, packFormat `1.0`, entry and integrity
`sha256-` plus base64 of the raw 32-byte digest. Malformed hashes or rejected hash
calls return diagnostics and no partial prepared result. No I/O or registration.

## Alternatives and consequences

Reconstructing a distribution index would reuse one input shape, but invents
unavailable metadata and weakens provenance. Rejected.

Saving the whole collection simplifies selection, but carries thousands of unused
definitions and violates used-only persistence. Rejected.

An explicit source union preserves provenance and enables offline subset reduction.
Selected, with a small additive API and validation cost at the save boundary.

This row prepares bytes and locks only. M18.75 integrates writer/loader validation,
M18.76 integrates hosts, and M18.14 retains complete offline acceptance. Document
and container versions do not change. Legacy unresolved-reference provenance is
not inferred here; any later exception must be explicit in the integration API.

## Verification

A document using three of 5,000 supplied definitions saves exactly those three,
including a grouped child. Tests constrain deterministic bytes and locks, complete
credits, embedded-only reduced preparation, invalid sources, missing references,
hash failures and asynchronous ownership. API reports and a format changeset
accompany implementation. Focused tests accompany the implementation; full offline acceptance remains pending.
