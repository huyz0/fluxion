---
status: accepted
date: 2026-10-26
decision-makers: harness (M18.13; independently reviewed plan implementing ADR-0048)
---

# ADR-0181 — Lazy shape-pack loading through explicit host ports

## Context

The M18.12 parsers validate metadata and complete categories. FR-LIB-009 additionally
requires metadata-only search, first-use category loading and shared concurrent loads.
ADR-0048 requires cache identity to include namespace, exact version and index hash.

## Decision

Add an SDK adapter accepting original index bytes, an explicit license policy, a positive
safe-integer byte cap, and caller-supplied read and SHA-256 ports. The reader receives the
cap and must enforce it during I/O; the adapter checks returned length before copying.
There is no hidden network/filesystem access, default permissive license policy or
mandatory synchronous main-thread hash. The same cap bounds each index and category.

Snapshot index/category bytes, verify original-byte hashes, decode UTF-8 strictly and use
the existing pack parsers. Cache only a whole validated category. Return structured
FLX_PACK_INVALID diagnostics for transport/hash/decoding failures and preserve parser
errors. No definition is registered or exposed from a failed category.

Each loader owns its cache, keyed by category within its immutable namespace/version/index
hash identity. Install the pending promise before calling a host port, including reentrant
readers. Share concurrent requests and retain successful loads. Remove failed pending
entries; only a later explicit call can retry. No automatic retries are introduced.

Freeze validated JSON metadata and definitions iteratively before exposure. Search uses
only metadata, matches every case-insensitive query token as a substring of ID/name/keywords,
and preserves index order. An empty query returns all metadata. Snapshot capabilities and
limits when creating the loader so later replacement of option properties cannot change
its integrity policy.

## Compatibility and proof

Existing PackSpec and registration APIs are unchanged. This additive SDK contract ships
with a minor changeset, generated API report and tests for 5000 metadata entries, isolated
category reads, concurrency, ownership, bounds and integrity failures. No runtime dependency
is added. Portable used-definition storage remains M18.14; UI installation remains later
work. Plan approval does not substitute for implementation verification or independent review.
