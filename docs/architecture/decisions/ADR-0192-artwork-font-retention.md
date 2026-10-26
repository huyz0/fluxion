---
status: accepted
date: 2026-10-26
decision-makers: harness (existing M18.81 requirements; independent plan review before implementation)
---

# ADR-0192 — Exact licensed artwork fonts in portable shape packs

## Context and drivers

M18.80 qualifies the shipped witness against the original SVG corpus. A successful import currently reports required exact faces but does not carry their bytes through pack registration and offline save/reopen. M18.81 owns that remaining FR-LIB-004 / FR-AST-003 / NFR-LIC-003 obligation; M18.16 CLI pack assembly depends on it. Shape pack 1.0 and known data-only locks are strict and cannot silently acquire new required fields.

## Options

1. Resolve imported family names through ordinary theme fonts. Smallest change, but a same-name different-byte face changes artwork and missing theme references lose imported bytes. Rejected.
2. Reject all text-bearing imports or require manual embedding. Simple but does not meet the existing import and offline-retention acceptance. Rejected.
3. Add a strict pack 1.1 resource/face/rights envelope, verified acquisition and a used-definition portable closure. Chosen: explicit ownership and compatibility cost, but exact identity survives deduplication, collisions and offline use.

## Decision outcome

Keep 1.0 valid and its strict parser exports unchanged. Add version-aware envelope parsers and 1.1 variants consistently across distribution index/category/subset and `declarative-shapes` locks. New readers require lock/envelope versions, namespace and version to agree. Old known-lock readers reject 1.1; test the preserved old parser, not a mock. New writers preserve source format, including an empty-font 1.1 used subset. No silent downgrade.

A 1.1 envelope adds `fontResources`, `fontFaces`, `definitionFonts`, and `fontCredits`. Resources identify exact lowercase SHA-256, actual byte size, WOFF2 MIME and supported profile; distribution resources use safe canonical `fonts/<sha>.woff2` paths, retained resources resolve content-addressed assets. Faces carry source family, 400/normal and resource identity. Definition bindings name exactly the source text closure. Credits carry explicit resource and definition scopes plus license, complete notice, attribution and inert source metadata. Reject duplicate/dangling/unreachable entries and missing or superfluous closure. Index validation cannot inspect unloaded geometry; validate it at category acquisition. A saved subset validates all included definitions.

The first supported profile remains ADR-0189 pinned Inter 400 normal ASCII. This is not arbitrary-font, variable-font or subsetting support. Font rights use the existing OFL-1.1/Apache-2.0 policy independently of shape licenses. Preserve all applicable scoped notices when byte payloads deduplicate; never infer rights from family names or fetch source/notice URLs.

SDK metadata search performs no font I/O. A resource-aware acquisition entry snapshots inputs before awaits and returns verified definition, immutable bindings and owned byte copies. Existing fontless APIs retain 1.0 behavior and refuse unsupported 1.1 rather than discard obligations. Validate hash, size, format, supported profile and complete rights before host effects. Failed/cancelled acquisition has no partial document, registry or history mutation.

Hosts register exact faces under deterministic private aliases derived from identity. Only renderer-facing attributes use those aliases; canonical artwork and original family metadata remain unchanged. Editor/player/inline/CLI must use the same mapping and strict readiness path. Ordinary document fonts retain existing behavior. Dispose only resources owned by that consumer; undo/redo and another document's registrations remain valid.

Use existing generic binary asset records, without ordinary `font.family` descriptors for artwork-only bytes. Versioned subset metadata is authoritative. Saving computes the used-definition closure, retains its exact assets and scoped credits, and omits unused bindings/notices. One hash means one binary, not one rights record. Archive and inline readers rehash before strict registration, and missing/corrupt resources fail rather than fall back.

Retain 5 MiB per font, 8 faces / 8 MiB raw per definition acquisition, existing 32 MiB predicted CLI transport and destination file-loader limits. These are not global pack/document eight-face limits. The new retention writer preflight explicitly checks its final archive against the destination's effective entry/count/total limits; ordinary legacy writer behavior is unchanged. Include all entries, not only fonts.

Public return-type widening is not called additive: classify each affected pre-1.0 API change with the required minor changeset, ADR reference, migration notes and generated API reports. Preserve old 1.0 runtime fixtures. Document schema/container major versions need not change solely to use existing binary assets and versioned known pack locks, conditional on actual old-reader refusal and new-reader round-trip tests.

## Delivery and confirmation

Implement separate reviewed metadata, acquisition, persistence and host slices, followed by M18.81 end-to-end closure. No slice alone closes M18.81. New contracts travel with generated reports, fixtures and migration notes. Gate acceptance must cover:

- strict old/new/invalid versions; missing, corrupt, oversized, unlicensed and wrong-profile resources refuse atomically;
- a real non-Inter ordinary font using the same source family as imported Inter, with distinct observed glyph pixels before/after offline archive and inline reopen;
- missing imported bytes refuse instead of drawing the ordinary face;
- multiple packs/aliases deduplicate one pinned binary while retaining each used scoped notice;
- removing definitions prunes only unreachable artwork resources, bindings and credits;
- more than eight installed aliases remain valid when each acquisition is within its own bound;
- actual browser and CLI registration/rendering, cancellation, cleanup and ownership.

M18.48/39/40 font WASM/subsetting remains separate. No 60,000-byte subset result is claimed. This plan neither changes fidelity tolerances nor licenses nor retries.

## Consequences

Positive: exact artwork survives offline use, collisions and pruning without new font guessing. Negative: version-aware pack metadata and explicit resource ownership add public API migration and cross-host testing. Scope stays within already planned font retention; new arbitrary font profiles or document-major changes require a separate decision.

Links: ADR-0182, ADR-0183, ADR-0189; M18.81; contracts.md.
