---
status: accepted
date: 2026-10-26
decision-makers: harness (M18.76 independently reviewed plan round 2)
---

# ADR-0185 — Keep portable shape sources scoped to the open document

## Context

ADR-0182–0184 validate and serialize used shape data, but hosts currently discard plugin
locks and do not install saved geometry before rendering. FR-LIB-009 requires files to
remain useful without their original distribution. A registry contains geometry, not
license/provenance evidence; inferring save sources from registry entries loses credits.

## Decision

Retain validated subsets, opaque plugin locks and loaded unresolved-reference provenance
in Studio's opened file state. Both Studio and the inline player provide the explicit
content-license policy to the reader. Register saved geometry into a fresh document-local
registry before exposing rendering resources. Never activate opaque code plugins.

A pure core helper validates all incoming subsets and conflicts before registration,
then rolls back its new registrations if a later insertion refuses. It rejects existing
namespace ownership even for disjoint IDs and even when the registry source name matches.
The registry does not record versions, so conservatively rejecting an occupied namespace
prevents mixing installed and embedded versions. Existing entries are never replaced.

Portable host saves retain embedded sources as authoritative. An explicit API accepts
additional distribution or embedded sources for new namespaces; duplicate namespaces
across loaded and supplied sources fail. SDK clients can provide validated metadata and
resolved geometry without waiting for import UI. The host never invents rights metadata
from a registry or resolves sources implicitly from namespace strings.

Collect unresolved shape IDs from the loaded file against explicit bundled and embedded
IDs. Only those loaded IDs may be preserved unresolved on subsequent saves. Surface the
portable writer's diagnostics in Save feedback; newly introduced unresolved references
fail. JSON-only input carries no pack payload and cannot promise self-contained geometry.

The standalone player and custom-element scripts retain real Zod. Their previous inert
alias refused the newly required `.safeParse()` calls even for valid portable data.
Remove that alias and manual schema-purity configuration only for these two host builds;
the routing-only chunk keeps its existing configuration. Built-output tests verify valid
files and reject malformed known data after hashes are recomputed. Source-module tests
alone do not establish shipped-script validation. Actual hard/advisory bundle sizes are
reported under ADR-0176. This amends ADR-0026's former blanket exclusion of Zod.

Recovery journals carry an optional structured-clone file state atomically with document
metadata: saved geometry, opaque entries/locks, source, manifest extras and the original
unresolved-ID set. The set is never inferred from replayed edited records. Resumed journals
retain this state; older journals without it cannot invent geometry or source rights.
This additive field needs no IndexedDB store/version migration.

## Alternatives

Register globally: rejected because opening one file could change another file's geometry.
Infer provenance from the current registry: rejected because definitions omit complete
pack/credit information. Prefer installed versions silently: rejected because offline and
online renderings could differ. Overwrite same-source registry IDs: rejected because source
names do not establish version equivalence.

## Consequences and qualification

Public host/core APIs gain additive source and registration capabilities, with API reports
and changesets. Existing legacy files and asset/font flows remain supported. Conflicts fail
before a document is exposed, and inline cleanup retains its existing lifetime contract.

Tests constrain all-input preflight, rollback, same/disjoint-ID namespace conflicts, actual
host open/save/reopen including opaque bytes, new-document explicit distribution sources,
loaded-versus-new unresolved IDs, and browser feedback/render registration. Full offline
three-of-5000 browser equivalence remains M18.14; attribution display UI remains M18.33.
Implementation is qualified by the task tests and independent code review, not this decision alone.
