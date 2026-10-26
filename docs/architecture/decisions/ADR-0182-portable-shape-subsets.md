---
status: accepted
date: 2026-10-26
decision-makers: harness (M18.73; implementation of independently reviewed M18.14 plan)
---

# ADR-0182 — Portable shape subsets and explicit content policy

## Context and drivers

FR-LIB-009 and NFR-LIC-003 require a saved document to carry used geometry and its
applicable credits. ADR-0048/0050 define portable data locks; ADR-0178 implements the
separate distribution index/category envelopes. Reopening a saved subset must not
require the original distribution index, an installed pack, or a network request.

## Options

- Reconstruct a distribution index from saved geometry. Rejected: labels, category
  descriptors and original category hashes are absent; inventing them loses provenance.
- Save the full distribution. Rejected: three used definitions would carry all5000.
- Validate a distinct used-definition envelope with shared geometry/credit rules.
  Selected: explicit format identity, no fabricated metadata, existing validation.

## Decision

`ShapePackSubset` has exactly format:"fluxion-shape-pack", formatVersion:"1.0", id,
exact-semver version, license, attribution, definitions:ShapeDef[] and credits:ShapePackCredit[].
Both arrays are nonempty; an unused namespace has no saved entry. Definitions are unique
and namespace-bound. Credits are unique, reference only included definitions, and cover
every included definition. Preserve every notice, attribution and source declaration.
The structural schema cannot establish semantic validity; parseShapePackSubset calls the
existing ShapeDef/artwork parser and common source-credit/license validation atomically.
Failure returns structured diagnostics and no accepted subset. There is no registry effect.

The caller still supplies an explicit ShapePackLicensePolicy. A pure bounded runtime
adapter implements the repository's existing content allowlist and SPDX expression
semantics for future Studio/inline hosts. It does not import Node gate modules or grant
code-pack exceptions to arbitrary content. Harness parity tests bind its decisions to
LICENSES.allow in thresholds.mjs plus the existing content additions in tech-stack.md.
AND requires both branches; OR permits an allowed alternative; WITH retains the gate's
base-license semantics. Malformed expressions and bounded-input overflow fail closed.
This is policy validation, not proof of ownership or a new redistribution grant.

Subsequent M18.74–76 implement used-only preparation, format integrity locks/read-write,
and document-scoped host registration. Sources explicitly distinguish full distribution
metadata from a previously loaded embedded subset. An offline remove/resave must use
only the latter, retaining global credits and intersecting definition-scoped credits.
No document1.7/container1.0 version changes. Known data is validated; unknown executable
plugin data remains opaque and unexecuted. M18.14 stays open for complete offline browser
acceptance. Attribution display is separately tracked as M18.33.

## Consequences and confirmation

Saved geometry can be validated without an unavailable index. There is a second envelope
and a small runtime policy adapter to maintain; shared semantic checks and harness parity
prevent silent divergence. No runtime dependency is added and no policy floor changes.

M18.73 tests valid saved fixtures, malicious geometry/artwork, duplicate/wrong-namespace
IDs, incomplete/invalid credits, unsupported versions, and rejected/throwing policies.
Existing distribution tests remain unchanged. Generated schema/API reports accompany the
additive API. Later persistence tests must prove exactly3of5000 definitions, integrity
refusal and offline editor/inline rendering before the parent acceptance task closes.

## References

ADR-0048, ADR-0050, ADR-0178, ADR-0180; architecture08/09; M18.14 and M18.73–76.
