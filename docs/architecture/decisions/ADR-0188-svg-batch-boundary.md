---
status: accepted
date: 2026-10-26
decision-makers: harness (M18.79; existing FR-LIB-004/NFR-SEC-001; plan review required before implementation)
---

# ADR-0188 — Share bounded SVG batch reports before host distribution

## Context and Problem Statement

M18.15 converts one checked SVG. Folder/ZIP imports need shared deterministic
selection, resource limits and failure reporting. CLI/editor loops must not diverge.
M18.16 remains open until its production host and pack distribution qualify.

## Decision Drivers

- FR-LIB-004: preserve every input outcome and shared conversion semantics.
- NFR-SEC-001: reuse bounded decoding and path validation before effects.
- Preserve source identity and explicit fonts without claiming rights or distribution.

## Considered Options

1. Separate host loops: fewer initial APIs, but divergent limits, selection and IDs.
   Rejected because CLI/editor parity would rely on duplicate implementations.
2. One shared pure batch boundary: deterministic reports and injected effects.
   Chosen; host lifecycle, font transport and distribution remain explicit prerequisites.

## Decision Outcome

## Input

`SvgBatchInput = {kind:'files'; files: readonly {path:string; bytes:Uint8Array}[]} | {kind:'zip'; bytes:Uint8Array}`.
`SvgBatchOptions = Omit<SvgImportOptions,'id'> & {ids: Readonly<Record<string,string>>}`.
An exact explicit source-path-to-qualified-ID mapping is required for every selected SVG, and extra keys fail preflight. No filename slug inference. Use the existing qualifiedNameSchema from schema, also used by core; no divergent regular expression. Duplicate target IDs fail preflight.

All regular files whose extension is ASCII-case-insensitive `.svg` are selected SVG inputs. Directory records are structural and not in the conversion denominator; they must have empty bytes. Other regular files remain report items with unsupported-input refusal (not silently dropped). Metadata/font files must be supplied separately to this pure service; a future host may explicitly reserve/extract sidecars before selecting inputs but must disclose that selection. Every regular file contributes to `inputCount`; `svgCount` records SVG selection, `acceptedCount` counts only accepted conversions. Empty files or directory-only archives are preflight failures.

## Preflight and ownership

Before any asynchronous witness, reuse readZip (4096entries,128MiBentry,256MiBtotal) and namesProblem (absolute, traversal, backslash, controls, NFC/case collisions). Bound compressed input at256MiB before parsing. Named input has identical entry and total caps. Add opt-in strictNames to readZip, checking both local and central filename UTF8 with decodeUtf8Strict; existing callers retain replacement behavior. Legitimate U+FFFD names remain allowed. Reject bad entry metadata/unsafe names/collisions/invalid or missing IDs/empty selection globally. No archive extraction occurs. Directory and unsupported records still count toward resource caps.

Check byte lengths before copying. Snapshot all enumerated input bytes, IDs, colors, tokenRefs and font records before the first await so caller mutation cannot change later conversion or source hashes. Process sequentially in code-unit lexicographic path order. Catch malformed runtime input at the public boundary as a failed report, not an unhandled exception; trusted witness failures are already refused by importSvgShape.

Per-input UTF8 decode is strict and limited before parsing: at most8MiB encoded SVG (a conservative maximum for2Mi UTF16characters), then existing2Mi-character/20000node/depth64 sanitizer bounds. Unknown files are never XML parsed. Hash original bytes with existing sha256Hex. Metadata `path` is separate from nested Diagnostic.path to avoid ambiguous path rewriting.

## Report

`SvgBatchReport` discriminates:
- `{status:'preflight-failed', enumerationComplete:boolean, diagnostics:Diagnostic[], inputs:readonly {path:string,status:'not-attempted'}[]}`. For corrupt/oversized ZIP or unreadable input structure, enumerationComplete=false and no invented member list. For complete enumeration followed by path/ID/limit failure, include all known regular paths as not-attempted, preserving duplicate occurrences. No witness called.
- `{status:'processed', inputCount:number, svgCount:number, acceptedCount:number, inputs: readonly SvgBatchOutcome[]}`. One item per regular member, stable path ordering. Each item includes source path and originalSHA256, and either `{status:'accepted',value:SvgImportResult}` or `{status:'refused',diagnostics:Diagnostic[]}`. Conversion refusal never silently truncates later reporting. Processed does not imply all accepted and does not authorize distribution. Success for CLI's later transaction requires acceptedCount===inputCount and validated metadata/fonts/license policy.

Use existing FLX_SVG_IMPORT_INVALID/UNSUPPORTED diagnostics, with distinct messages and stable nested paths. No new diagnostic enum is required.

## Verification and boundary

Tests must first fail for missing API, then constrain malformedUTF8, corruptZIP, traversal/collisions, duplicate/missingIDs, sourcehashes, stableordering, structuraldirectories, unsupportedmembers, per-inputmixedfailures, no-witness-on-preflight, snapshotownership and honestcounts. Frozen50 unit tests exercise real converter with explicit deterministic test witness only; they are pure API coverage, not real-host proof. Existing M18.15 renderer qualification remains separate. Full batch actual-host corpus qualification is required by M18.80/M18.16 before those tasks close, with unchanged tolerance and no missing fixtures.


## Consequences

Hosts can share reports without sharing filesystem/browser dependencies. Reports
retain refused source identities and do not confuse partial conversion with packs.
Additional production witness, font transport and CLI transaction contracts remain
necessary; this decision neither implements nor approves those wire/runtime details.

## Confirmation

Pure boundary tests and API snapshots qualify M18.79. M18.16 still requires the
frozen corpus through its shipped host, four anchors per shape, preserved fonts and
rights, CLI schema tests, atomic output and browser parity. No thresholds change.

## Links

ADR-0049, ADR-0050, ADR-0153 and ADR-0187.
