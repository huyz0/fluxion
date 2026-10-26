---
status: accepted
date: 2026-10-26
decision-makers: harness (M18.75; independent integration plan round 2 and schema clarification passed)
---

# ADR-0184 — Validate portable shape data and retain save diagnostics

## Context and drivers

FR-LIB-009 and NFR-LIC-003 require offline used geometry and complete credits.
ADR-0182/0183 supply the envelope and preparation API. NFR-SEC-001 and NFR-REL-002
require known data to be validated before exposure, without executing opaque plugins.
Existing byte-returning writers cannot report successful legacy-preservation warnings.

## Options

Treat every plugin entry as opaque. This preserves legacy bytes cheaply but cannot
establish geometry, license or integrity validity. Rejected for the known data kind.

Add a diagnostic callback to existing writers. This preserves return types but makes
warning delivery an optional side effect and complicates failure/ownership semantics.
Rejected in favor of explicit results.

Add portable composition APIs with structured output and diagnostics, and shared strict
validation for known locks in existing readers/writers. Selected: existing APIs retain
their return types, while new hosts cannot accidentally discard the warning channel.

## Decision

`writePortableFlux` receives ordinary writer inputs plus explicit sources, builtin IDs,
content policy and optional loaded unresolved-ID provenance. Its result carries bytes
and diagnostics. `writePortableFluxHtml` returns HTML and the same diagnostics. Hosts
must surface warnings. Existing `writeFlux` and `writeFluxHtml` return types stay intact.

Preparation tolerates an unresolved ID only when explicitly supplied as previously
unresolved. It emits `FLX_PACK_UNRESOLVED_PRESERVED` (warning), preserves the reference
and invents no geometry. New unresolved IDs fail. Invalid known sources still fail.
The host owns the provenance set; a namespace string never implies permission.

Known `declarative-shapes` locks require the explicit `shapePackLicensePolicy` in both
full and lean loaders and the low-level writer. Validate strict lock keys, unique
namespace/path, exact entry name, identity/version, canonical SHA-256 integrity, and
manifest hash plus byte size on load. Existing archive limits bound bytes before strict
UTF-8 and JSON decoding. The complete subset uses core's existing geometry/credit parser.
Failure returns `FILE_SHAPE_PACK_INVALID` with structured diagnostics and no partial
accepted packs. Loading does not register definitions. A malformed manifest table
cannot conceal otherwise recognizable known locks.

`LoadedFlux.shapePacks` exposes accepted subsets alongside preserved original entries
and locks. Portable resave validates old known data before removing only its owned
entries, then merges newly prepared data and retained opaque bytes without collisions.
Unknown code locks remain opaque and unexecuted. Empty usage removes old known geometry.

Capture document, assets, opaque locks and entry bytes before asynchronous composition.
Do not silently repair or migrate during save: a snapshot that would change through
parsing is refused; opening/repair remains the loader's explicitly reported operation.
Preserve existing canonical serialization and its geometry rounding.

Use the already pinned catalog Zod 4.6.6 (MIT) directly in format for lock validation.
No new package version or license exception is introduced. This avoids unchecked casts
and keeps format-owned lock contracts out of core. Normal license and bundle checks run.
The lean reader intentionally gains the same safety boundary as the full reader;
embedding budgets retain ADR-0176's advisory status, with actual sizes reported.

## Compatibility and consequences

Document 1.7 and container 1.0 remain unchanged. Legacy files without known locks need
no new policy. Callers handling known data must supply the policy; hosts adopting the
new writers consume diagnostics explicitly. The added schema diagnostic and format
error code are additive. Existing opaque extension roundtrips remain supported.

Validation and byte snapshots cost CPU/memory at save/open boundaries. They prevent
mixed asynchronous revisions and partial registration. No runtime/compiler migration.
`.flux.json` has no plugin payload API and gains no false portability claim here.
M18.76 integrates actual hosts; M18.14 retains offline browser acceptance; M18.33 owns
credit-display UI. These tasks are not closed by format tests.

## Confirmation

Tests constrain ZIP/HTML full and lean reopen, offline reduction using only loaded data,
opaque preservation, collision refusal, warnings with and without explicit provenance,
async snapshots, hash failures, strict UTF-8 and no silent repair. Adversarial fixtures
recompute hashes so malformed geometry/rights reach semantic checks. API reports,
portable-lock fixture, changesets, license checks and full verification accompany this
change. See ADR-0048, ADR-0050, ADR-0182, ADR-0183 and the M18.75 reviewed plan.
